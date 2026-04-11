'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { fetchApiAuthed } from '@/lib/auth-client';

type Block = {
  id: string;
  job_id: string;
  starts_at: string;
  ends_at: string;
  title: string;
  notes: string | null;
};

export default function ScheduleClient() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchApiAuthed('/api/schedule?days=60');
        if (res.status === 401) {
          if (!cancelled) {
            setErr('Sign in to see your schedule.');
            setBlocks([]);
          }
          return;
        }
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { blocks: Block[] };
        if (!cancelled) {
          setBlocks(data.blocks ?? []);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <AppShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end border-l-4 border-[#FF6B00] pl-3 sm:pl-4 mb-6 min-w-0">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter">SCHEDULE</h1>
          <p className="text-[#a98a7d] text-xs font-mono mt-1">NEXT 60 DAYS · YOUR JOBS</p>
        </div>
        <Link href="/operations" className="text-[10px] font-mono text-[#FF6B00] hover:underline shrink-0">
          Operations →
        </Link>
      </div>

      {loading && <p className="text-xs font-mono text-[#5a4136]">Loading…</p>}
      {err && <div className="border border-amber-500/40 bg-amber-950/25 p-3 text-sm mb-4">{err}</div>}

      {!loading && !err && blocks.length === 0 && (
        <p className="text-sm text-[#a98a7d]">No upcoming blocks. Add them from each job&apos;s Run job page.</p>
      )}

      <ul className="space-y-3 max-w-2xl">
        {blocks.map((b) => (
          <li key={b.id} className="border-2 border-[#353534] p-4">
            <div className="text-sm font-black text-[#ffb693]">{b.title}</div>
            <div className="text-[11px] font-mono text-[#a98a7d] mt-1">
              {new Date(b.starts_at).toLocaleString()} — {new Date(b.ends_at).toLocaleString()}
            </div>
            <Link
              href={`/job/${b.job_id}`}
              className="inline-block mt-2 text-[10px] font-mono text-[#FF6B00] hover:underline"
            >
              Open job →
            </Link>
            {b.notes && <p className="text-xs text-[#5a4136] mt-2">{b.notes}</p>}
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
