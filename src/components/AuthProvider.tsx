'use client';

import { createContext, useContext, useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    void (async () => {
      // Only use getSession() — never getUser() here.
      // getUser() triggers a server-side token refresh which races with
      // concurrent calls from other components / Vercel edge functions,
      // consuming the single-use refresh token and causing @supabase/ssr
      // to call signOut() globally, destroying the session.
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      setEmail(session?.user?.email ?? null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      setEmail(session?.user?.email ?? null);
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
