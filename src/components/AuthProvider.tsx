'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createClient, isSupabaseConfigured } from '@/utils/supabase/client';

type AuthContextValue = {
  email: string | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ email: null, loading: true });

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => Boolean(isSupabaseConfigured));
  const verifiedRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;

      if (session?.user?.email) {
        setEmail(session.user.email);
        setLoading(false);
        verifiedRef.current = true;
        return;
      }

      // getSession() returned null — the cached session may be stale while
      // the middleware already refreshed the cookies. Fall back to getUser()
      // which validates server-side and triggers a proper token refresh.
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      setEmail(user?.email ?? null);
      setLoading(false);
      verifiedRef.current = !!user;
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      if (session?.user?.email) {
        setEmail(session.user.email);
        verifiedRef.current = true;
      } else if (verifiedRef.current) {
        // Session went null but we recently had a verified user — the refresh
        // token may have been consumed by the middleware. Re-check with getUser()
        // before clearing the email (avoids false sign-outs).
        verifiedRef.current = false;
        void (async () => {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.email) {
            setEmail(user.email);
            verifiedRef.current = true;
          } else {
            setEmail(null);
          }
        })();
      } else {
        setEmail(session?.user?.email ?? null);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
      sub?.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ email, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
