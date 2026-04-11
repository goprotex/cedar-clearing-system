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
  let { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) session = data.session;
  }
  const token = session?.access_token;

  let res = await fetch(url, withBearer(init, token));
  if (res.status === 401) {
    await syncAuthSessionToCookies();
    const { data: r, error: refErr } = await supabase.auth.refreshSession();
    const s2 = !refErr && r.session ? r.session : (await supabase.auth.getSession()).data.session;
    res = await fetch(url, withBearer(init, s2?.access_token));
  }
  return res;
}
