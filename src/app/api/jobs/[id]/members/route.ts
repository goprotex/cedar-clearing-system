import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { canManageJobMembers } from '@/lib/job-members-admin';

type Role = 'owner' | 'worker' | 'viewer';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canManageJobMembers(supabase, jobId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { userId?: string; role?: Role };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const targetUserId = typeof body.userId === 'string' ? body.userId : '';
  const newRole = body.role;
  if (!targetUserId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  if (newRole !== 'owner' && newRole !== 'worker' && newRole !== 'viewer') {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const { data: target, error: tErr } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', targetUserId)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

  if (target.role === 'owner' && newRole !== 'owner') {
    const { count, error: cErr } = await supabase
      .from('job_members')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('role', 'owner');
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'Job must keep at least one owner.' }, { status: 400 });
    }
  }

  const { error: upErr } = await supabase
    .from('job_members')
    .update({ role: newRole })
    .eq('job_id', jobId)
    .eq('user_id', targetUserId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canManageJobMembers(supabase, jobId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let targetUserId: string | undefined;
  try {
    const b = await req.json();
    targetUserId = typeof b.userId === 'string' ? b.userId : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!targetUserId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

  const { data: target, error: tErr } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', targetUserId)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

  if (target.role === 'owner') {
    const { count, error: cErr } = await supabase
      .from('job_members')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('role', 'owner');
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'Cannot remove the only owner.' }, { status: 400 });
    }
  }

  const { error: delErr } = await supabase
    .from('job_members')
    .delete()
    .eq('job_id', jobId)
    .eq('user_id', targetUserId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
