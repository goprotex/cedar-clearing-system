'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

function LoginPageInner() {
  const searchParams = useSearchParams();
  const signupIntent = searchParams.get('signup') === '1' || searchParams.get('mode') === 'signup';
  const [mode, setMode] = useState<'magic' | 'password-signin' | 'password-signup'>(
    () => (signupIntent ? 'password-signup' : 'magic'),
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const envMissing = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

  useEffect(() => {
    if (signupIntent) setMode('password-signup');
  }, [signupIntent]);

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
          <p className="text-[10px] text-[#5a4136] mt-3 leading-relaxed border border-[#353534]/80 p-2.5 rounded-sm">
            <span className="text-[#a98a7d]">How sign-in works:</span>{' '}
            <strong className="text-[#e5e2e1]">Magic link</strong> — no password; we email you a link.{' '}
            <strong className="text-[#e5e2e1]">Sign up</strong> — choose email + password (at least 8 characters).{' '}
            <strong className="text-[#e5e2e1]">Sign in</strong> — use the password you set at sign up.{' '}
            After you are logged in, open <strong className="text-[#ffb693]">Settings</strong> to change password or email.
          </p>
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

        {(mode === 'password-signin' || mode === 'password-signup') && (
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">
              Password
            </label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={mode === 'password-signup' ? 'new-password' : 'current-password'}
              placeholder="••••••••"
              className="w-full bg-transparent border border-[#353534] px-3 py-2 text-sm font-mono text-[#e5e2e1] placeholder:text-[#5a4136] focus:border-[#FF6B00] outline-none"
            />
            {(mode === 'password-signup' || mode === 'password-signin') && (
              <div className="text-[10px] font-mono text-[#a98a7d]">
                {mode === 'password-signup'
                  ? 'Use at least 8 characters. If email confirmation is on in Supabase, confirm your email before signing in.'
                  : 'Use the password you chose at sign up (8+ characters).'}
              </div>
            )}
            {mode === 'password-signin' && (
              <button
                type="button"
                disabled={envMissing || busy || !email.trim()}
                onClick={async () => {
                  try {
                    setBusy(true);
                    setErr(null);
                    setMessage(null);
                    if (envMissing) throw new Error('Supabase env vars are missing.');
                    const supabase = createClient();
                    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/settings')}`;
                    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
                    if (error) throw error;
                    setMessage('If an account exists for that email, we sent a reset link. Open it, then set a new password on Settings.');
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : 'Request failed.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="text-[10px] font-mono text-[#FF6B00] hover:underline disabled:opacity-40 disabled:no-underline text-left"
              >
                Forgot password? Email me a reset link
              </button>
            )}
          </div>
        )}

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

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => { setMode('magic'); setErr(null); setMessage(null); }}
            className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest border transition-colors ${
              mode === 'magic' ? 'border-[#FF6B00] text-[#FFB693]' : 'border-[#353534] text-[#a98a7d] hover:text-white'
            }`}
          >
            MAGIC_LINK
          </button>
          <button
            type="button"
            onClick={() => { setMode('password-signin'); setErr(null); setMessage(null); }}
            className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest border transition-colors ${
              mode === 'password-signin' ? 'border-[#FF6B00] text-[#FFB693]' : 'border-[#353534] text-[#a98a7d] hover:text-white'
            }`}
          >
            SIGN_IN
          </button>
          <button
            type="button"
            onClick={() => { setMode('password-signup'); setErr(null); setMessage(null); }}
            className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest border transition-colors ${
              mode === 'password-signup' ? 'border-[#FF6B00] text-[#FFB693]' : 'border-[#353534] text-[#a98a7d] hover:text-white'
            }`}
          >
            SIGN_UP
          </button>
        </div>

        <button
          disabled={
            envMissing ||
            busy ||
            !email.trim() ||
            (mode === 'password-signup' && password.length < 8) ||
            (mode === 'password-signin' && password.length < 1)
          }
          onClick={async () => {
            try {
              setBusy(true);
              setErr(null);
              setMessage(null);
              if (envMissing) throw new Error('Supabase env vars are missing.');
              const supabase = createClient();

              if (mode === 'magic') {
                const redirectTo = `${window.location.origin}/auth/callback`;
                const { error } = await supabase.auth.signInWithOtp({
                  email: email.trim(),
                  options: { emailRedirectTo: redirectTo },
                });
                if (error) throw error;
                setMessage('Magic link sent. Check your email to finish signing in.');
              } else if (mode === 'password-signin') {
                const { error } = await supabase.auth.signInWithPassword({
                  email: email.trim(),
                  password,
                });
                if (error) throw error;
                window.location.href = '/bids';
              } else {
                const redirectTo = `${window.location.origin}/auth/callback`;
                const { error } = await supabase.auth.signUp({
                  email: email.trim(),
                  password,
                  options: { emailRedirectTo: redirectTo },
                });
                if (error) throw error;
                setMessage('Account created. Check your email to confirm, then sign in.');
              }
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Auth failed.');
            } finally {
              setBusy(false);
            }
          }}
          className="w-full bg-[#FF6B00] text-black font-black py-2 text-xs uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy
            ? 'WORKING…'
            : mode === 'magic'
              ? 'SEND_MAGIC_LINK'
              : mode === 'password-signin'
                ? 'SIGN_IN'
                : 'CREATE_ACCOUNT'}
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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#131313] flex items-center justify-center text-[#a98a7d] font-mono text-sm">Loading…</div>}>
      <LoginPageInner />
    </Suspense>
  );
}
