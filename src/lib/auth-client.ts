import { createClient } from '@/utils/supabase/client';

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
 * Authenticated fetch: sends Authorization Bearer from the Supabase session.
 *
 * Uses getSession() exclusively — never getUser() or refreshSession() — to
 * avoid consuming the single-use refresh token. The Supabase browser client
 * manages token refresh internally via its auto-refresh timer; we just read
 * whatever session is currently available.
 */
export async function fetchApiAuthed(url: string, init?: RequestInit): Promise<Response> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;

  return fetch(url, withBearer(init, accessToken));
}
