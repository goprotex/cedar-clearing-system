'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function InviteJoinInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [status, setStatus] = useState<'idle' | 'working' | 'ok' | 'err'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!token.trim()) {
      setStatus('err');
      setMessage('Missing invite token in URL.');
      return;
    }
    let cancelled = false;
    (async () => {
      setStatus('working');
      try {
        const res = await fetch('/api/jobs/invites/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ token: token.trim() }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; jobId?: string; bidId?: string };
        if (cancelled) return;
        if (!res.ok) {
          setStatus('err');
          setMessage(
            data.error === 'email_mismatch'
              ? 'Sign in with the same email the invite was sent to.'
              : data.error === 'expired'
                ? 'This invite has expired. Ask the job owner for a new one.'
                : data.error === 'invalid_or_used'
                  ? 'This invite link is invalid or was already used.'
                  : data.error ?? 'Could not accept invite.',
          );
          return;
        }
        setStatus('ok');
        setJobId(data.bidId ?? data.jobId ?? null);
        setMessage('You have joined the job.');
      } catch (e) {
        if (!cancelled) {
          setStatus('err');
          setMessage(e instanceof Error ? e.message : 'Request failed.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] flex items-center justify-center p-6">
      <div className="w-full max-w-md border-2 border-[#353534] bg-[#0e0e0e] p-6 space-y-4">
        <div className="text-[#FF6B00] text-xl font-black uppercase tracking-widest">JOB_INVITE</div>
        {status === 'working' && <p className="text-sm font-mono text-[#a98a7d]">Accepting…</p>}
        {status === 'ok' && (
          <>
            <p className="text-sm text-[#13ff43]">{message}</p>
            <div className="flex flex-col gap-2">
              {jobId && (
                <Link
                  href={`/bid/${jobId}`}
                  className="text-center bg-[#FF6B00] text-black font-black py-2 text-xs uppercase"
                >
                  Open bid
                </Link>
              )}
              <Link href="/operations" className="text-center border border-[#353534] py-2 text-xs uppercase text-[#e5e2e1] hover:border-[#FF6B00]">
                Operations
              </Link>
            </div>
          </>
        )}
        {status === 'err' && (
          <>
            <p className="text-sm text-red-300">{message}</p>
            <Link href="/login" className="block text-center text-[#FF6B00] text-sm underline">
              Sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function InviteJoinClient() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#131313] text-[#a98a7d] flex items-center justify-center font-mono text-sm">
        Loading…
      </div>
    }
    >
      <InviteJoinInner />
    </Suspense>
  );
}
