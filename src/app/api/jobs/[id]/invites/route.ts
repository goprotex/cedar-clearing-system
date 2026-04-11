import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateInviteToken, hashInviteToken } from '@/lib/invite-token';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Owner creates an invite; returns one-time token for the share link. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: me, error: meErr } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
  if (!me || me.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { email?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const role = body.role === 'viewer' ? 'viewer' : 'worker';

  const token = generateInviteToken();
  const token_hash = hashInviteToken(token);

  const { data: row, error: insErr } = await supabase
    .from('job_invites')
    .insert({
      job_id: jobId,
      email,
      role,
      token_hash,
      invited_by: userId,
    })
    .select('id, email, role, created_at, expires_at')
    .single();

  if (insErr) {
    if (insErr.code === '23505') {
      return NextResponse.json({ error: 'An invite for this email is already pending.' }, { status: 409 });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    invite: row,
    token,
  });
}

/** Owner cancels a pending invite */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: me, error: meErr } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
  if (!me || me.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let inviteId: string | undefined;
  try {
    const b = await req.json();
    inviteId = typeof b.inviteId === 'string' ? b.inviteId : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!inviteId) return NextResponse.json({ error: 'Missing inviteId' }, { status: 400 });

  const { error: delErr } = await supabase
    .from('job_invites')
    .delete()
    .eq('id', inviteId)
    .eq('job_id', jobId);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
