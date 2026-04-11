import { createClient } from '@/utils/supabase/client';

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
 * Authenticated fetch: sends Authorization Bearer from the Supabase session so API routes
 * see the user even when auth cookies are missing or blocked.
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
