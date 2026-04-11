'use client';

import { createContext, useContext, useEffect, useState } from 'react';
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
  const [loading, setLoading] = useState(() => isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const supabase = createClient();
    let cancelled = false;

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      setEmail(session?.user?.email ?? null);
      setLoading(false);
    })();

    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setEmail(data.session?.user?.email ?? null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
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
