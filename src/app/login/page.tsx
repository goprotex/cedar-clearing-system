'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const envMissing = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

  useEffect(() => {
    if (envMissing) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (data.user) {
        window.location.href = '/bids';
      }
    })();
    return () => { cancelled = true; };
  }, [envMissing]);

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] flex items-center justify-center p-6">
      <div className="w-full max-w-md border-2 border-[#353534] bg-[#0e0e0e] p-6 space-y-4">
        <div>
          <div className="text-[#FF6B00] text-2xl font-black uppercase tracking-widest">LOGIN</div>
          <div className="text-xs font-mono text-[#a98a7d] mt-1">
            Sign in to enable multi-user Jobs and shared progress tracking.
          </div>
        </div>

        {envMissing && (
          <div className="border border-red-500/50 bg-red-950/40 p-3 text-sm">
            Supabase env is not configured. Set{' '}
            <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY</code>.
          </div>
        )}

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">
            Email
          </label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            className="w-full bg-transparent border border-[#353534] px-3 py-2 text-sm font-mono text-[#e5e2e1] placeholder:text-[#5a4136] focus:border-[#FF6B00] outline-none"
          />
        </div>

        {err && (
          <div className="border border-red-500/50 bg-red-950/40 p-3 text-sm">
            {err}
          </div>
        )}
        {message && (
          <div className="border border-green-500/30 bg-green-950/20 p-3 text-sm text-green-200">
            {message}
          </div>
        )}

        <button
          disabled={envMissing || busy || !email.trim()}
          onClick={async () => {
            try {
              setBusy(true);
              setErr(null);
              setMessage(null);
              if (envMissing) throw new Error('Supabase env vars are missing.');
              const supabase = createClient();
              const redirectTo = `${window.location.origin}/auth/callback`;
              const { error } = await supabase.auth.signInWithOtp({
                email: email.trim(),
                options: {
                  emailRedirectTo: redirectTo,
                },
              });
              if (error) throw error;
              setMessage('Magic link sent. Check your email to finish signing in.');
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Failed to send magic link.');
            } finally {
              setBusy(false);
            }
          }}
          className="w-full bg-[#FF6B00] text-black font-black py-2 text-xs uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'SENDING…' : 'SEND_MAGIC_LINK'}
        </button>

        <div className="flex items-center justify-between text-[11px] text-[#a98a7d]">
          <Link href="/bids" className="hover:text-white underline underline-offset-2">
            Back to Bids
          </Link>
          <Link href="/sys-health" className="hover:text-white underline underline-offset-2">
            System Health
          </Link>
        </div>
      </div>
    </div>
  );
}

