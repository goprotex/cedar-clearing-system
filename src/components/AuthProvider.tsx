'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

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
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    const supabase = supabaseRef.current;

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
