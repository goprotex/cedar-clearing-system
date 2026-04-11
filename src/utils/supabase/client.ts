import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? "";

/** Single browser client so session storage is shared (avoids 401 on API calls while UI shows signed in). */
let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export const createClient = () => {
  if (typeof window === "undefined") {
    return createBrowserClient(supabaseUrl, supabaseKey);
  }
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabaseKey);
  }
  return browserClient;
};

export const isSupabaseConfigured =
  !!supabaseUrl && !!supabaseKey;
