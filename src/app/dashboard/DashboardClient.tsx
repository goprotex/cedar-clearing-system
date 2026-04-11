'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import JobTeamPanel from '@/components/operations/JobTeamPanel';
import JobNotesAndProgressPanel from '@/components/operations/JobNotesAndProgressPanel';
import { mergeJobsById, loadLocalStorageJobs, type ActiveJobSummary } from '@/lib/active-jobs';
import { fetchApiAuthed } from '@/lib/auth-client';

type CompanyProfile = {
  id: string;
  full_name: string;
  role: string;
  phone: string | null;
  company_id: string | null;
  avatar_url: string | null;
  created_at: string;
  email?: string | null;
};

const PROFILE_ROLES = ['owner', 'manager', 'operator', 'crew_lead', 'viewer'] as const;

export default function DashboardClient() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<CompanyProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const [jobs, setJobs] = useState<ActiveJobSummary[]>([]);
  const [jobsBusy, setJobsBusy] = useState(true);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchApiAuthed('/api/company/profiles');
      if (res.status === 401) {
        setProfiles([]);
        setErr('Sign in to view the employee dashboard.');
        return;
      }
      if (res.status === 403) {
        setProfiles([]);
        setErr('Only company owners and managers can open this dashboard.');
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { profiles: CompanyProfile[] };
      setProfiles(data.profiles ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setJobsBusy(true);
        const res = await fetchApiAuthed('/api/monitor/bootstrap');
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { jobs: ActiveJobSummary[] };
        if (cancelled) return;
        let remoteJobs = data.jobs ?? [];
        const localStored = loadLocalStorageJobs();
        if (localStored.length > 0) remoteJobs = mergeJobsById(remoteJobs, localStored);
        else if (remoteJobs.length === 0) remoteJobs = loadLocalStorageJobs();
        setJobs(remoteJobs);
      } catch {
        if (!cancelled) {
          const localJobs = loadLocalStorageJobs();
          setJobs(localJobs);
        }
      } finally {
        if (!cancelled) setJobsBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setEditRole(selected.role);
    setEditName(selected.full_name ?? '');
    setEditPhone(selected.phone ?? '');
    setEditEmail(selected.email ?? '');
  }, [selected]);

  const saveProfile = async () => {
    if (!selectedId) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetchApiAuthed(`/api/company/profiles/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: editName,
          phone: editPhone.trim() || null,
          role: editRole,
          ...(editEmail.trim() && editEmail.trim() !== (selected?.email ?? '') ? { email: editEmail.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      await loadProfiles();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [jobs],
  );

  const patchJob = (jobId: string, patch: Partial<ActiveJobSummary>) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...patch } : j)));
  };

  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4 border-l-4 border-[#FF6B00] pl-3 sm:pl-4 mb-8 min-w-0">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter">EMPLOYEE_DASHBOARD</h1>
          <p className="text-[#a98a7d] text-xs font-mono mt-1">ROSTER // ROLES // JOB ASSIGNMENTS</p>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] font-mono">
          <Link href="/settings" className="text-[#FF6B00] hover:underline">
            My account &amp; photo
          </Link>
          <Link href="/operations" className="text-[#a98a7d] hover:text-[#13ff43]">
            Operations
          </Link>
        </div>
      </div>

      {loading && <div className="text-xs font-mono text-[#5a4136] py-6">LOADING…</div>}

      {!loading && err && !profiles.length && (
        <div className="border border-amber-500/40 bg-amber-950/30 p-4 text-sm text-amber-100 max-w-xl">{err}</div>
      )}

      {!loading && profiles.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-7xl">
          <section className="xl:col-span-1 border-2 border-[#353534] p-4 space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Team ({profiles.length})</h2>
            <ul className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
              {profiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                    className={`w-full text-left flex items-center gap-2 px-2 py-2 border transition-colors ${
                      selectedId === p.id ? 'border-[#13ff43] bg-[#13ff43]/5' : 'border-[#353534] hover:border-[#a98a7d]'
                    }`}
                  >
                    {p.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-[#353534]" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-[#353534] flex items-center justify-center text-[10px] text-[#a98a7d] font-mono">
                        {(p.full_name || p.email || '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold truncate">{p.full_name || '—'}</div>
                      <div className="text-[9px] font-mono text-[#a98a7d] truncate">{p.email ?? p.id.slice(0, 8)}</div>
                      <div className="text-[9px] text-[#13ff43]">{p.role}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="xl:col-span-2 border-2 border-[#353534] p-4 space-y-4">
            {!selected && (
              <p className="text-sm text-[#a98a7d]">Select a team member to edit their app role, contact info, or email.</p>
            )}
            {selected && (
              <>
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Edit profile</h2>
                {err && <div className="text-sm text-red-300 border border-red-500/30 p-2">{err}</div>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Display name</label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-transparent border border-[#353534] px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Phone</label>
                    <input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="w-full bg-transparent border border-[#353534] px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-[#5a4136] uppercase block mb-1">App role</label>
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="w-full bg-[#1a1a1a] border border-[#353534] px-3 py-2 text-sm"
                    >
                      {PROFILE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <p className="text-[9px] text-[#5a4136] mt-1">Controls company-wide permissions (monitor, roster, etc.).</p>
                  </div>
                  <div>
                    <label className="text-[9px] text-[#5a4136] uppercase block mb-1">Email (Supabase auth)</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="w-full bg-transparent border border-[#353534] px-3 py-2 text-sm font-mono"
                    />
                    <p className="text-[9px] text-[#5a4136] mt-1">Requires SUPABASE_SERVICE_ROLE_KEY on the server.</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveProfile()}
                  className="bg-[#FF6B00] text-black font-black px-4 py-2 text-xs uppercase tracking-widest hover:bg-white disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>

                <div className="border-t border-[#353534] pt-4 mt-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d] mb-2">Assign to jobs</h3>
                  <p className="text-[10px] text-[#5a4136] mb-3">
                    Invite by email or adjust per-job crew roles below. Owners and managers can manage teams on company jobs.
                  </p>
                  {jobsBusy && <div className="text-[10px] font-mono text-[#5a4136]">Loading jobs…</div>}
                  {!jobsBusy && sortedJobs.length === 0 && (
                    <p className="text-xs text-[#a98a7d]">No jobs visible yet. Convert bids to jobs or sync from operations.</p>
                  )}
                  {!jobsBusy && sortedJobs.length > 0 && (
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                      {sortedJobs.map((j) => (
                        <div key={j.id} className="border border-[#353534]">
                          <button
                            type="button"
                            onClick={() => setExpandedJobId(expandedJobId === j.id ? null : j.id)}
                            className="w-full text-left px-3 py-2 flex justify-between items-center gap-2 hover:bg-[#1a1a1a]"
                          >
                            <span className="text-xs font-bold truncate">{j.title}</span>
                            <span className="text-[10px] font-mono text-[#a98a7d] shrink-0">{expandedJobId === j.id ? '−' : '+'}</span>
                          </button>
                          {expandedJobId === j.id && (
                            <div className="px-3 pb-3 border-t border-[#353534] space-y-1">
                              <JobTeamPanel jobId={j.id} />
                              <JobNotesAndProgressPanel job={j} onJobPatch={(p) => patchJob(j.id, p)} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
