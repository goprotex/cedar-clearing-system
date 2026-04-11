import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

export async function createClient(request?: Request) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY.');
  }

  const bearerFromRequest = request?.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const headersList = await headers();
  const bearerFromNext = headersList.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const bearer = bearerFromRequest ?? bearerFromNext;
  if (bearer) {
    return createSupabaseJsClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${bearer}`,
        },
      },
    });
  }

  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Component: ignore
          }
        },
      },
    },
  );
}

/**
 * Resolve the signed-in user for API routes. When the client sends `Authorization: Bearer <jwt>`,
 * pass the JWT into `getUser(jwt)` — `getUser()` alone does not use the bearer-only client session
 * (persistSession: false), which caused 401s in production for fetchApiAuthed calls.
 */
export async function getUserFromRequest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  request?: Request,
) {
  const bearerFromRequest = request?.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const headersList = await headers();
  const bearerFromNext = headersList.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const bearer = bearerFromRequest ?? bearerFromNext;
  if (bearer) {
    return supabase.auth.getUser(bearer);
  }
  return supabase.auth.getUser();
}
