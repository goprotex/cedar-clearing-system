'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import type { UserAppPreferences } from '@/types/profile';
import { useAuth } from '@/components/AuthProvider';
import { createClient, isSupabaseConfigured } from '@/utils/supabase/client';
import { fetchApiAuthed } from '@/lib/auth-client';

type SettingsPayload = {
  email: string | null;
  can_edit_own_role?: boolean;
  profile: {
    full_name: string;
    role: string;
    phone: string | null;
    company_id: string | null;
    company_name: string | null;
    avatar_url: string | null;
    preferences: UserAppPreferences;
  } | null;
};

export default function SettingsClient() {
  const { email: authEmail, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [email, setEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('operator');
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [canEditOwnRole, setCanEditOwnRole] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [monitorTv, setMonitorTv] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchApiAuthed('/api/settings');
      if (res.status === 401) {
        setEmail(null);
        setFullName('');
        setPhone('');
        setRole('operator');
        setCompanyName(null);
        setAvatarUrl(null);
        setCanEditOwnRole(false);
        setMonitorTv(false);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as SettingsPayload;
      setEmail(data.email);
      setCanEditOwnRole(Boolean(data.can_edit_own_role));
      setNewEmail(data.email ?? '');
      if (data.profile) {
        setFullName(data.profile.full_name ?? '');
        setPhone(data.profile.phone ?? '');
        setRole(data.profile.role ?? 'operator');
        setCompanyName(data.profile.company_name);
        setAvatarUrl(data.profile.avatar_url ?? null);
        setMonitorTv(Boolean(data.profile.preferences?.monitor_tv_default));
      } else {
        setFullName('');
        setPhone('');
        setRole('operator');
        setCompanyName(null);
        setAvatarUrl(null);
        setMonitorTv(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isSupabaseConfigured) {
      void load();
      return;
    }
    if (!authEmail) {
      setLoading(false);
      setEmail(null);
      setFullName('');
      setPhone('');
      setRole('operator');
      setCompanyName(null);
      setAvatarUrl(null);
      setCanEditOwnRole(false);
      setMonitorTv(false);
      setErr(null);
      return;
    }
    void load();
  }, [authLoading, authEmail, load]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const supabase = createClient();
      if (newPassword || confirmPassword) {
        if (newPassword !== confirmPassword) throw new Error('Passwords do not match');
        if (newPassword.length < 8) throw new Error('Password must be at least 8 characters');
        const { error: pwErr } = await supabase.auth.updateUser({ password: newPassword });
        if (pwErr) throw new Error(pwErr.message);
        setNewPassword('');
        setConfirmPassword('');
      }
      if (newEmail.trim() && newEmail.trim().toLowerCase() !== (email ?? '').toLowerCase()) {
        const { error: emErr } = await supabase.auth.updateUser({ email: newEmail.trim() });
        if (emErr) throw new Error(emErr.message);
      }

      const res = await fetchApiAuthed('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          phone: phone.trim() || null,
          ...(canEditOwnRole ? { role } : {}),
          avatar_url: avatarUrl,
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

  const uploadAvatar = async (file: File) => {
    setAvatarUploading(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { data: { session: s } } = await supabase.auth.getSession();
      const uid = s?.user?.id;
      if (!uid) throw new Error('Not signed in');
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${uid}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, {
        upsert: true,
        contentType: file.type || 'image/jpeg',
      });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      setAvatarUrl(pub.publicUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAvatarUploading(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4 border-l-4 border-[#FF6B00] pl-4 mb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">SETTINGS</h1>
          <p className="text-[#a98a7d] text-xs font-mono mt-1">PROFILE // APP // ACCOUNT</p>
        </div>
        <div className="flex flex-wrap gap-4 text-[10px] font-mono">
          <Link href="/dashboard" className="text-[#13ff43] hover:underline">
            Employee dashboard
          </Link>
          <Link href="/operations" className="text-[#FF6B00] hover:underline">
            ← Operations
          </Link>
        </div>
      </div>

      {(loading || authLoading) && (
        <div className="text-xs font-mono text-[#5a4136] py-8">LOADING…</div>
      )}

      {!loading && !authLoading && !email && (
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

      {!loading && !authLoading && email && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
          <section className="border-2 border-[#353534] p-5 space-y-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Profile</h2>
            <div>
              <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Profile photo</label>
              <div className="flex items-center gap-3 flex-wrap">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border border-[#353534]" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-[#353534] flex items-center justify-center text-xs text-[#a98a7d] font-mono">
                    —
                  </div>
                )}
                <label className="cursor-pointer text-[10px] font-mono border border-[#353534] px-3 py-2 hover:border-[#FF6B00]">
                  {avatarUploading ? 'Uploading…' : 'Upload image'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={avatarUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void uploadAvatar(f);
                    }}
                  />
                </label>
              </div>
              <p className="text-[9px] text-[#5a4136] mt-1">JPEG, PNG, WebP, or GIF — then save settings.</p>
            </div>
            <div>
              <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Sign-in email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full bg-transparent border border-[#353534] px-3 py-2 text-sm font-mono"
              />
              <p className="text-[9px] text-[#5a4136] mt-1">Changing email may require confirmation from your inbox.</p>
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
                disabled={!canEditOwnRole}
                className="w-full bg-[#1a1a1a] border border-[#353534] px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="owner">Owner</option>
                <option value="manager">Manager</option>
                <option value="operator">Operator</option>
                <option value="crew_lead">Crew lead</option>
                <option value="viewer">Viewer</option>
              </select>
              <p className="text-[10px] text-[#5a4136] mt-1">
                {canEditOwnRole
                  ? 'Company owner or manager — you can change your role here.'
                  : 'Only company owners and managers can change app roles. Ask an admin or use the employee dashboard.'}
              </p>
            </div>
          </section>

          <section className="border-2 border-[#353534] p-5 space-y-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Security</h2>
            <div>
              <label className="text-[9px] text-[#5a4136] uppercase block mb-1">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-transparent border border-[#353534] px-3 py-2 text-sm font-mono"
                placeholder="Leave blank to keep current"
              />
            </div>
            <div>
              <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-transparent border border-[#353534] px-3 py-2 text-sm font-mono"
              />
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
              <Link href="/logout" prefetch={false} className="text-sm font-mono text-red-400/90 hover:text-red-300">
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
