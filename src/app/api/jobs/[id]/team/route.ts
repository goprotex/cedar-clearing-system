import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: teamRes, error: teamErr } = await supabase.rpc('get_job_team', { p_job_id: jobId });
  if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });
  const team = teamRes as { ok?: boolean; error?: string; members?: unknown } | null;
  if (!team?.ok) {
    return NextResponse.json({ error: team?.error ?? 'team_load_failed' }, { status: 403 });
  }

  let pendingInvites: unknown[] | null = null;
  if (me.role === 'owner') {
    const { data: invRes, error: invErr } = await supabase.rpc('get_job_invites_pending', { p_job_id: jobId });
    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
    const inv = invRes as { ok?: boolean; invites?: unknown[] } | null;
    if (inv?.ok) pendingInvites = (inv.invites as unknown[]) ?? [];
  }

  return NextResponse.json({
    myRole: me.role,
    members: team.members ?? [],
    pendingInvites,
  });
}
