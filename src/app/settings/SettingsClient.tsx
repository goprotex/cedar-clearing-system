'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import type { UserAppPreferences } from '@/types/profile';

type SettingsPayload = {
  email: string | null;
  profile: {
    full_name: string;
    role: string;
    phone: string | null;
    company_id: string | null;
    company_name: string | null;
    preferences: UserAppPreferences;
  } | null;
};

export default function SettingsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [email, setEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('operator');
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [monitorTv, setMonitorTv] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/settings', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        setEmail(null);
        setFullName('');
        setPhone('');
        setRole('operator');
        setCompanyName(null);
        setMonitorTv(false);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as SettingsPayload;
      setEmail(data.email);
      if (data.profile) {
        setFullName(data.profile.full_name ?? '');
        setPhone(data.profile.phone ?? '');
        setRole(data.profile.role ?? 'operator');
        setCompanyName(data.profile.company_name);
        setMonitorTv(Boolean(data.profile.preferences?.monitor_tv_default));
      } else {
        setFullName('');
        setPhone('');
        setRole('operator');
        setCompanyName(null);
        setMonitorTv(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          phone: phone.trim() || null,
          role,
          preferences: { monitor_tv_default: monitorTv },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setSaved(true);
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4 border-l-4 border-[#FF6B00] pl-4 mb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">SETTINGS</h1>
          <p className="text-[#a98a7d] text-xs font-mono mt-1">PROFILE // APP // ACCOUNT</p>
        </div>
        <Link href="/operations" className="text-[10px] font-mono text-[#FF6B00] hover:underline">
          ← Operations
        </Link>
      </div>

      {loading && (
        <div className="text-xs font-mono text-[#5a4136] py-8">LOADING…</div>
      )}

      {!loading && !email && (
        <div className="border-2 border-[#353534] p-6 max-w-lg space-y-4">
          <p className="text-sm text-[#a98a7d]">Sign in to edit your profile and app preferences.</p>
          <Link
            href="/login"
            className="inline-block bg-[#FF6B00] text-black font-black px-4 py-2 text-xs uppercase tracking-widest hover:bg-white"
          >
            Sign in
          </Link>
        </div>
      )}

      {!loading && email && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
          <section className="border-2 border-[#353534] p-5 space-y-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Profile</h2>
            <div>
              <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Email</label>
              <div className="text-sm font-mono text-[#e5e2e1]">{email}</div>
            </div>
            {companyName && (
              <div>
                <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Company</label>
                <div className="text-sm text-[#ffb693]">{companyName}</div>
              </div>
            )}
            <div>
              <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Display name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-transparent border border-[#353534] px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Phone</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-transparent border border-[#353534] px-3 py-2 text-sm font-mono"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Your role (app)</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#353534] px-3 py-2 text-sm"
              >
                <option value="owner">Owner</option>
                <option value="manager">Manager</option>
                <option value="operator">Operator</option>
                <option value="crew_lead">Crew lead</option>
                <option value="viewer">Viewer</option>
              </select>
              <p className="text-[10px] text-[#5a4136] mt-1">Separate from per-job roles on shared jobs.</p>
            </div>
          </section>

          <section className="border-2 border-[#353534] p-5 space-y-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">App</h2>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={monitorTv}
                onChange={(e) => setMonitorTv(e.target.checked)}
                className="mt-1 accent-[#FF6B00]"
              />
              <span>
                <span className="text-sm text-[#e5e2e1] block">Open scout monitor in fullscreen TV layout</span>
                <span className="text-[10px] text-[#5a4136] font-mono">Applies on next visit to /monitor</span>
              </span>
            </label>

            <div className="border-t border-[#353534] pt-4 space-y-2">
              <h3 className="text-[10px] font-bold uppercase text-[#a98a7d]">Account</h3>
              <Link href="/logout" className="text-sm font-mono text-red-400/90 hover:text-red-300">
                Sign out
              </Link>
            </div>
          </section>

          {err && (
            <div className="lg:col-span-2 border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">
              {err}
            </div>
          )}
          {saved && !err && (
            <div className="lg:col-span-2 text-sm text-[#13ff43] font-mono">Saved.</div>
          )}

          <div className="lg:col-span-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="bg-[#FF6B00] text-black font-black px-6 py-3 text-xs uppercase tracking-widest hover:bg-white disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
