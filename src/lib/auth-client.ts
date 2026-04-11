import { createClient } from '@/utils/supabase/client';

/**
 * Ensures the current Supabase session is written to cookies (via @supabase/ssr
 * browser client) so Route Handlers and `createClient()` in server code see the user.
 */
export async function syncAuthSessionToCookies(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.getSession();
}

function withBearer(init: RequestInit | undefined, accessToken: string | undefined): RequestInit {
  const headers = new Headers(init?.headers);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return {
    ...init,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  };
}

/**
 * fetch with session: sends `Authorization: Bearer <access_token>` so API routes
 * authenticate even when auth cookies are missing (common with cross-site / IT policies).
 * Also syncs cookies and retries once on 401.
 */
export async function fetchApiAuthed(url: string, init?: RequestInit): Promise<Response> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  let res = await fetch(url, withBearer(init, token));
  if (res.status === 401) {
    await syncAuthSessionToCookies();
    const { data: { session: s2 } } = await supabase.auth.getSession();
    res = await fetch(url, withBearer(init, s2?.access_token));
  }
  return res;
}
