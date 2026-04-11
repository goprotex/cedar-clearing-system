import { createClient } from '@/utils/supabase/client';

export async function syncAuthSessionToCookies(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.getSession();
}

function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as { exp?: number };
  } catch {
    return null;
  }
}

/** True if missing, malformed, expired, or within skewMs of expiry (refresh early). */
function accessTokenNeedsRefresh(token: string | undefined, skewMs = 120_000): boolean {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (typeof payload?.exp !== 'number') return true;
  return Date.now() >= payload.exp * 1000 - skewMs;
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

async function ensureFreshAccessToken(supabase: ReturnType<typeof createClient>) {
  let {
    data: { session },
  } = await supabase.auth.getSession();
  let token = session?.access_token;
  if (!token || accessTokenNeedsRefresh(token)) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      session = data.session;
      token = data.session.access_token;
    }
  }
  return { session, accessToken: session?.access_token };
}

/**
 * Authenticated fetch: sends Authorization Bearer from the Supabase session so API routes
 * see the user even when auth cookies are missing or blocked.
 *
 * Refreshes the access token when it is missing or near expiry so the server always receives
 * a valid JWT. (Middleware may refresh cookies on the *response*, while Route Handlers still
 * read the *incoming* request cookies in the same round-trip — a stale JWT there causes 401.)
 */
export async function fetchApiAuthed(url: string, init?: RequestInit): Promise<Response> {
  const supabase = createClient();
  let { accessToken } = await ensureFreshAccessToken(supabase);

  let res = await fetch(url, withBearer(init, accessToken));
  if (res.status === 401) {
    await syncAuthSessionToCookies();
    await supabase.auth.getUser();
    const { data: r, error: refErr } = await supabase.auth.refreshSession();
    const s2 = !refErr && r.session ? r.session : (await supabase.auth.getSession()).data.session;
    accessToken = s2?.access_token;
    res = await fetch(url, withBearer(init, accessToken));
  }
  return res;
}
