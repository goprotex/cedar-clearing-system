'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { isSupabaseConfigured } from '@/utils/supabase/client';

/** Routes reachable without a session (sign-in, OAuth return, invite links). */
function isPublicPath(pathname: string): boolean {
  if (pathname === '/login' || pathname === '/logout') return true;
  if (pathname.startsWith('/auth/')) return true;
  if (pathname.startsWith('/invite')) return true;
  return false;
}

/**
 * Blocks the app behind a modal until the user is signed in (when Supabase is configured).
 * Without env keys, the gate is disabled so local/dev use is not locked out.
 */
export default function AuthRequiredGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { email, loading } = useAuth();
  const publicRoute = isPublicPath(pathname);

  const gateActive = isSupabaseConfigured && !publicRoute;
  const blocked = gateActive && !loading && !email;
  const checking = gateActive && loading;

  useEffect(() => {
    if (!gateActive) {
      document.body.style.overflow = '';
      return;
    }
    if (checking || blocked) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [gateActive, checking, blocked]);

  if (!gateActive) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      {(checking || blocked) && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-gate-title"
        >
          {checking ? (
            <div className="text-center text-[#a98a7d] text-sm font-mono">Checking session…</div>
          ) : (
            <div className="w-full max-w-md border-2 border-[#FF6B00] bg-[#0e0e0e] p-6 shadow-2xl shadow-black/80">
              <h2 id="auth-gate-title" className="text-[#FF6B00] text-xl font-black uppercase tracking-widest">
                Sign in required
              </h2>
              <p className="text-sm text-[#a98a7d] mt-3 leading-relaxed">
                Create an account or sign in to use Cedar Hack. This page is blocked until you are authenticated.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/login"
                  className="flex-1 text-center bg-[#FF6B00] text-black font-black uppercase tracking-widest py-3 px-4 text-sm hover:bg-white transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  href="/login?signup=1"
                  className="flex-1 text-center border-2 border-[#353534] text-[#e5e2e1] font-bold uppercase tracking-widest py-3 px-4 text-sm hover:border-[#13ff43] hover:text-[#13ff43] transition-colors"
                >
                  Create account
                </Link>
              </div>
              <p className="text-[10px] font-mono text-[#5a4136] mt-4 text-center">
                Use “Sign up” on the next screen if you need a new account.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
