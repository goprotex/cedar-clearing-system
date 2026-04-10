import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';
 
export async function GET(req: Request) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  await supabase.auth.signOut();
 
  const url = new URL(req.url);
  url.pathname = '/';
  url.search = '';
  return NextResponse.redirect(url);
}

