'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/components/AuthProvider';
import { mergeJobsById, loadLocalStorageJobs, type ActiveJobSummary } from '@/lib/active-jobs';
import JobTeamPanel from '@/components/operations/JobTeamPanel';

type BootstrapResponse = {
  jobs: ActiveJobSummary[];
};

function pct(cleared: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((cleared / total) * 100)));
}

export default function OperationsClient() {
  const { email, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<ActiveJobSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setBusy(true);
        setErr(null);
        const res = await fetch('/api/monitor/bootstrap', { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as BootstrapResponse;
        if (cancelled) return;

        let remoteJobs = data.jobs ?? [];
        const localStored = loadLocalStorageJobs();
        if (localStored.length > 0) {
          remoteJobs = mergeJobsById(remoteJobs, localStored);
        } else if (remoteJobs.length === 0) {
          remoteJobs = loadLocalStorageJobs();
        }
        setJobs(remoteJobs);
      } catch (e) {
        if (cancelled) return;
        const localJobs = loadLocalStorageJobs();
        if (localJobs.length > 0) {
          setJobs(localJobs);
          setErr(null);
        } else {
          setErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [jobs],
  );

  const totals = useMemo(() => {
    const total = jobs.reduce((s, j) => s + (j.cedar_total_cells ?? 0), 0);
    const cleared = jobs.reduce((s, j) => s + (j.cedar_cleared_cells ?? 0), 0);
    return { total, cleared, pct: pct(cleared, total) };
  }, [jobs]);

  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4 border-l-4 border-[#FF6B00] pl-4 mb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">OPERATIONS</h1>
          <p className="text-[#a98a7d] text-xs font-mono mt-1">ACTIVE_JOBS // CREW // PREFERENCES</p>
        </div>
        <div className="text-right text-[10px] font-mono text-[#a98a7d]">
          {authLoading ? 'AUTH…' : email ? <span className="text-[#13ff43] truncate max-w-[220px] inline-block align-bottom" title={email}>SIGNED_IN</span> : <span>LOCAL_ONLY</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
        <section className="border-2 border-[#353534] p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Active jobs</h2>
            <Link
              href="/monitor"
              className="text-[10px] font-black uppercase tracking-widest text-[#FF6B00] hover:text-white border border-[#FF6B00]/50 px-2 py-1"
            >
              Scout map →
            </Link>
          </div>
          {busy && (
            <div className="text-xs font-mono text-[#5a4136] py-8">LOADING_JOBS…</div>
          )}
          {err && !busy && (
            <div className="border border-amber-500/40 bg-amber-950/20 p-3 text-sm text-amber-200/90 mb-4">
              {err} — showing local jobs only if available.
            </div>
          )}
          {!busy && sortedJobs.length === 0 && (
            <div className="text-sm text-[#a98a7d] py-4">
              No jobs yet. Convert a bid to a job from the bid editor, or sign in to load shared jobs.
            </div>
          )}
          {!busy && sortedJobs.length > 0 && (
            <ul className="space-y-2 max-h-[min(52vh,560px)] overflow-y-auto pr-1">
              {sortedJobs.map((j) => {
                const p = pct(j.cedar_cleared_cells, j.cedar_total_cells);
                const bidId = j.bid_snapshot?.id ?? (j.id.startsWith('job_') ? j.id.slice(4) : j.id);
                return (
                  <li key={j.id} className="border border-[#353534] p-3 hover:border-[#a98a7d]/80 transition-colors">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-black truncate">{j.title}</div>
                        <div className="text-[10px] font-mono text-[#a98a7d]">{j.status} · {new Date(j.created_at).toLocaleDateString()}</div>
                      </div>
                      <div className="text-xs font-black text-[#13ff43] shrink-0">{p}%</div>
                    </div>
                    <div className="mt-2 w-full h-1.5 bg-[#353534] rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#13ff43] to-[#00cc33]" style={{ width: `${p}%` }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 items-center">
                      <Link
                        href={`/bid/${bidId}`}
                        className="text-[10px] font-bold uppercase tracking-wider border border-[#353534] px-2 py-1 text-[#e5e2e1] hover:border-[#FF6B00] hover:text-[#FF6B00]"
                      >
                        Bid
                      </Link>
                      <Link
                        href={`/operate/${bidId}`}
                        className="text-[10px] font-bold uppercase tracking-wider border border-[#353534] px-2 py-1 text-[#e5e2e1] hover:border-[#FF6B00] hover:text-[#FF6B00]"
                      >
                        GPS op
                      </Link>
                      <Link
                        href="/monitor"
                        className="text-[10px] font-bold uppercase tracking-wider border border-[#353534] px-2 py-1 text-[#e5e2e1] hover:border-[#FF6B00] hover:text-[#FF6B00]"
                      >
                        Monitor
                      </Link>
                      <button
                        type="button"
                        onClick={() => setExpandedJobId((id) => (id === j.id ? null : j.id))}
                        className="text-[10px] font-bold uppercase tracking-wider border border-[#5a4136] px-2 py-1 text-[#a98a7d] hover:border-[#FF6B00] hover:text-[#FF6B00] ml-auto"
                      >
                        {expandedJobId === j.id ? 'Hide team' : 'Team'}
                      </button>
                    </div>
                    {expandedJobId === j.id && (
                      <JobTeamPanel jobId={j.id} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section className="border-2 border-[#353534] p-5">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d] mb-3">Fleet snapshot</h2>
            <div className="text-3xl font-black text-[#13ff43] tabular-nums">{totals.pct}%</div>
            <div className="text-[10px] font-mono text-[#5a4136] mt-1">{totals.cleared} / {totals.total} cells (all listed jobs)</div>
          </section>

          <section className="border-2 border-[#353534] p-5">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d] mb-2">Team</h2>
            <p className="text-xs text-[#a98a7d] leading-relaxed">
              Open a job above and expand <span className="text-[#ffb693]">Team</span> to invite crew by email (owners only). Invitees must sign in with that email and open the one-time link.
            </p>
          </section>

          <section className="border-2 border-[#353534] p-5">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d] mb-3">Settings</h2>
            <ul className="space-y-2 text-xs">
              <li>
                <Link href="/settings" className="text-[#FF6B00] hover:underline font-mono">
                  Profile &amp; app preferences
                </Link>
              </li>
              <li>
                <Link href="/login" className="text-[#e5e2e1] hover:text-[#13ff43] font-mono">
                  {email ? 'Re-auth / sign in' : 'Sign in'}
                </Link>
              </li>
              <li>
                <Link href="/sys-health" className="text-[#e5e2e1] hover:text-[#13ff43] font-mono">
                  System health
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <p className="text-[10px] font-mono text-[#5a4136] max-w-2xl">
        Job crew is stored in Supabase. Local-only jobs stay on this device until you convert the bid to a job while signed in.
      </p>
    </AppShell>
  );
}
