'use client';

import { useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';

export default function LogoutPage() {
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.signOut({ scope: 'local' }).finally(() => {
      window.location.href = '/';
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#131313] flex items-center justify-center text-[#a98a7d] font-mono text-sm">
      Signing out…
    </div>
  );
}
