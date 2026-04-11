import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let token: string | undefined;
  try {
    const b = await req.json();
    token = typeof b.token === 'string' ? b.token : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!token?.trim()) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const { data, error } = await supabase.rpc('accept_job_invite', { p_token: token.trim() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = data as { ok?: boolean; error?: string; job_id?: string; bid_id?: string };
  if (!result?.ok) {
    const code = result?.error ?? 'unknown';
    const status =
      code === 'not_authenticated' ? 401
        : code === 'email_mismatch' ? 403
          : code === 'expired' || code === 'invalid_or_used' || code === 'invalid_token' ? 400
            : 400;
    return NextResponse.json({ error: code }, { status });
  }

  return NextResponse.json({ jobId: result.job_id, bidId: result.bid_id });
}
