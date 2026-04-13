'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import JobExecutionPanel from '@/components/job/JobExecutionPanel';
import JobNotesAndProgressPanel from '@/components/operations/JobNotesAndProgressPanel';
import type { Job, JobEvent } from '@/types';
import type { ActiveJobSummary } from '@/lib/active-jobs';
import { loadLocalJobBundle } from '@/lib/jobs';
import { fetchApiAuthed } from '@/lib/auth-client';

function fmt(ts: string) {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export default function JobClient({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [isRemote, setIsRemote] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const res = await fetchApiAuthed(`/api/jobs/${jobId}`);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        const local = loadLocalJobBundle(jobId);
        if (local?.job) {
          if (!local.bid) throw new Error('Local job snapshot is missing the bid payload.');
          setJob({
            id: local.job.id,
            bid_id: local.job.bidId,
            title: local.job.title,
            status: local.job.status,
            created_at: local.job.createdAt,
            bid_snapshot: local.bid,
            cedar_total_cells: local.job.cedar_total_cells,
            cedar_cleared_cells: local.job.cedar_cleared_cells,
          });
          setEvents((local.events ?? []).map((e) => ({
            id: e.id,
            job_id: jobId,
            created_at: e.created_at,
            created_by: 'local',
            type: e.type,
            data: e.data,
          })));
          setIsRemote(false);
          setErr(null);
          return;
        }
      }
      throw new Error(await res.text());
    }
    const data = (await res.json()) as { job: Job; events: JobEvent[] };
    setJob(data.job);
    setEvents(data.events);
    setIsRemote(true);
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const progressPct = useMemo(() => {
    if (!job || !job.cedar_total_cells) return 0;
    return Math.round((job.cedar_cleared_cells / job.cedar_total_cells) * 100);
  }, [job]);

  const bidId = job?.bid_id ?? '';

  const setJobStatus = async (next: Job['status']) => {
    if (!isRemote) return;
    setStatusBusy(true);
    setStatusErr(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/status`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setJob((j) => (j ? { ...j, status: next } : j));
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4 border-l-4 border-[#FF6B00] pl-4 mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black uppercase tracking-tighter">RUN_JOB</h1>
          <p className="text-[#a98a7d] text-xs font-mono mt-1">FIELD // OFFICE // PROGRESS</p>
        </div>
        <Link href="/operations" className="text-[10px] font-mono text-[#FF6B00] hover:underline shrink-0">
          ← All jobs
        </Link>
      </div>

      {err && (
        <div className="border border-red-500/50 bg-red-950/40 p-3 text-sm mb-4">
          {err}
        </div>
      )}

      {job && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div className="min-w-0">
              <div className="text-[11px] font-mono text-[#a98a7d] truncate">{job.id}</div>
              {job.bid_snapshot?.bidNumber && (
                <div className="text-[11px] font-mono text-[#5a4136] truncate">
                  Bid {job.bid_snapshot.bidNumber}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {bidId && (
                <>
                  <Link
                    href={`/operate/${bidId}`}
                    className="px-3 py-2 text-xs bg-[#FF6B00] text-black font-black uppercase tracking-widest hover:bg-white"
                  >
                    GPS operate
                  </Link>
                  <Link
                    href="/monitor"
                    className="px-3 py-2 text-xs border border-[#353534] text-[#e5e2e1] hover:border-[#13ff43] font-bold uppercase tracking-widest"
                  >
                    Scout monitor
                  </Link>
                </>
              )}
              {bidId && (
                <Link
                  href={`/bid/${bidId}`}
                  className="px-3 py-2 text-xs border border-[#353534] text-[#a98a7d] hover:text-white font-bold uppercase tracking-widest"
                >
                  Bid editor
                </Link>
              )}
            </div>
          </div>

          <div className="border-2 border-[#353534] bg-[#0e0e0e] p-4 space-y-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-bold uppercase tracking-widest text-[#a98a7d]">Clearing progress</div>
              <div className="text-lg font-black text-[#13ff43] tabular-nums">{progressPct}%</div>
            </div>
            <div className="w-full h-2.5 bg-[#353534] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#13ff43] to-[#00cc33] rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono text-[#a98a7d]">
              <span>{job.cedar_cleared_cells} cleared</span>
              <span>{job.cedar_total_cells} cedar cells</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#353534]">
              <div>
                <div className="text-[10px] text-[#5a4136] uppercase mb-1">Job status</div>
                {isRemote ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={job.status}
                      disabled={statusBusy}
                      onChange={(e) => void setJobStatus(e.target.value as Job['status'])}
                      className="bg-[#1a1a1a] border border-[#353534] px-2 py-1.5 text-sm font-mono text-[#e5e2e1] min-w-[140px]"
                    >
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                      <option value="completed">completed</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                    {statusBusy && <span className="text-[10px] font-mono text-[#5a4136]">Saving…</span>}
                  </div>
                ) : (
                  <div className="text-sm font-bold uppercase">{job.status} <span className="text-[10px] font-mono text-[#5a4136] font-normal">(local)</span></div>
                )}
                {statusErr && <p className="text-[11px] text-red-400 mt-1">{statusErr}</p>}
              </div>
              <div>
                <div className="text-[10px] text-[#5a4136] uppercase mb-1">Created</div>
                <div className="text-sm font-mono">{fmt(job.created_at)}</div>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#5a4136] uppercase mb-1">Title</div>
              <div className="text-sm font-bold">{job.title}</div>
            </div>
          </div>

          <JobExecutionPanel
            jobId={job.id}
            isRemote={isRemote}
            bidSnapshot={job.bid_snapshot}
          />

          <JobNotesAndProgressPanel
            job={job as ActiveJobSummary}
            onJobPatch={(patch) => {
              setJob((prev) => prev ? { ...prev, ...patch } as Job : prev);
            }}
          />
        </>
      )}

      <div className="border-2 border-[#353534] bg-[#0e0e0e] p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-[#a98a7d] mb-3">Activity</div>
        {events.length === 0 ? (
          <div className="text-sm text-[#a98a7d]">No events yet — operator clears and shared progress show here when synced.</div>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {events.map((e) => (
              <div key={e.id} className="border border-[#353534] p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-mono text-[#a98a7d]">{fmt(e.created_at)}</div>
                  <div className="text-[10px] font-mono text-[#5a4136]">{e.type}</div>
                </div>
                {!!e.data && (
                  <pre className="mt-1 text-[11px] text-[#e5e2e1] whitespace-pre-wrap break-words">
                    {JSON.stringify(e.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
