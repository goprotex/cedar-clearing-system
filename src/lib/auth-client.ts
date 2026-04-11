import { createClient } from '@/utils/supabase/client';

/**
 * Ensures the current Supabase session is written to cookies (via @supabase/ssr
 * browser client) so Route Handlers and `createClient()` in server code see the user.
 * Call before fetch('/api/...') if you see 401 while the UI shows signed in.
 */
export async function syncAuthSessionToCookies(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.getSession();
}

/**
 * fetch with credentials; if 401, sync session and retry once (fixes cookie drift).
 */
export async function fetchApiAuthed(url: string, init?: RequestInit): Promise<Response> {
  await syncAuthSessionToCookies();
  const base = { ...init, credentials: 'same-origin' as RequestCredentials, cache: 'no-store' as RequestCache };
  let res = await fetch(url, base);
  if (res.status === 401) {
    await syncAuthSessionToCookies();
    res = await fetch(url, base);
  }
  return res;
}
