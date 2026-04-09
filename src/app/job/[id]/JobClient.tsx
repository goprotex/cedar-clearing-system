'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Job, JobEvent } from '@/types';

function fmt(ts: string) {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export default function JobClient({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setErr(null);
        const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { job: Job; events: JobEvent[] };
        if (cancelled) return;
        setJob(data.job);
        setEvents(data.events);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  const progressPct = useMemo(() => {
    if (!job || !job.cedar_total_cells) return 0;
    return Math.round((job.cedar_cleared_cells / job.cedar_total_cells) * 100);
  }, [job]);

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] p-4 md:p-8 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-mono text-[#a98a7d]">JOB</div>
          <div className="text-2xl font-black uppercase tracking-widest truncate">
            {job?.id ?? 'LOADING…'}
          </div>
          {job?.bid_snapshot?.bidNumber && (
            <div className="text-[11px] font-mono text-[#a98a7d] truncate">
              Bid: {job.bid_snapshot.bidNumber}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {job?.bid_id && (
            <Link
              href={`/bid/${job.bid_id}`}
              className="px-3 py-2 text-xs border border-[#353534] text-[#a98a7d] hover:text-white hover:bg-[#353534] font-bold uppercase tracking-widest"
            >
              View Bid
            </Link>
          )}
          <Link
            href="/bids"
            className="px-3 py-2 text-xs bg-[#FF6B00] text-black hover:bg-white font-black uppercase tracking-widest"
          >
            Bids
          </Link>
        </div>
      </div>

      {err && (
        <div className="border border-red-500/50 bg-red-950/40 p-3 text-sm">
          {err}
        </div>
      )}

      {job && (
        <div className="border border-[#353534] bg-[#0e0e0e] p-4 space-y-3">
          <div className="flex items-center justify-between text-xs font-mono text-[#a98a7d]">
            <span>CLEARING_PROGRESS</span>
            <span className="text-[#13ff43] font-bold">{progressPct}%</span>
          </div>
          <div className="w-full h-2 bg-[#353534] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#13ff43] to-[#00cc33] rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-[#a98a7d]">
            <span>
              {job.cedar_cleared_cells} cleared
            </span>
            <span>
              {job.cedar_total_cells} total
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="border border-[#353534] p-2">
              <div className="text-[10px] text-[#5a4136] uppercase">Status</div>
              <div className="font-bold">{job.status}</div>
            </div>
            <div className="border border-[#353534] p-2">
              <div className="text-[10px] text-[#5a4136] uppercase">Created</div>
              <div className="font-mono">{fmt(job.created_at)}</div>
            </div>
            <div className="border border-[#353534] p-2 col-span-2">
              <div className="text-[10px] text-[#5a4136] uppercase">Title</div>
              <div className="truncate">{job.title}</div>
            </div>
          </div>
        </div>
      )}

      <div className="border border-[#353534] bg-[#0e0e0e] p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-[#a98a7d] mb-3">Activity</div>
        {events.length === 0 ? (
          <div className="text-sm text-[#a98a7d]">No events yet.</div>
        ) : (
          <div className="space-y-2">
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
    </div>
  );
}

