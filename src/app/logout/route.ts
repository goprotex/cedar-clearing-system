import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(req: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
 
  const url = new URL(req.url);
  url.pathname = '/';
  url.search = '';
  return NextResponse.redirect(url);
}

