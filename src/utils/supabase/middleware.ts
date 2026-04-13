import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
  // Pass all requests through without server-side session refresh.
  //
  // The Supabase docs recommend calling getUser() here to refresh expired
  // tokens, but on Vercel's serverless/edge architecture, concurrent
  // middleware invocations race to consume the single-use refresh token.
  // The loser gets "invalid refresh token" and @supabase/ssr internally
  // calls signOut(), destroying the session — causing users to be logged
  // out immediately after signing in.
  //
  // Session refresh is instead handled by the browser client (AuthProvider)
  // and by fetchApiAuthed() which refreshes tokens before API calls.
  return NextResponse.next({ request });
}
