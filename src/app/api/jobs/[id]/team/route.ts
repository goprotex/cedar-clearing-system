import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import { isCompanyAdmin } from '@/lib/company-admin';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient(req);

  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: me, error: meErr } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });

  const companyAdmin = await isCompanyAdmin(supabase, userId);

  const { data: teamRes, error: teamErr } = await supabase.rpc('get_job_team', { p_job_id: jobId });
  if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });
  const team = teamRes as { ok?: boolean; error?: string; members?: unknown } | null;
  if (!team?.ok) {
    return NextResponse.json({ error: team?.error ?? 'team_load_failed' }, { status: 403 });
  }

  const canManageTeam = me?.role === 'owner' || companyAdmin;

  let pendingInvites: unknown[] | null = null;
  if (canManageTeam) {
    const { data: invRes, error: invErr } = await supabase.rpc('get_job_invites_pending', { p_job_id: jobId });
    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
    const inv = invRes as { ok?: boolean; invites?: unknown[] } | null;
    if (inv?.ok) pendingInvites = (inv.invites as unknown[]) ?? [];
  }

  return NextResponse.json({
    myRole: me?.role ?? null,
    canManageTeam,
    members: team.members ?? [],
    pendingInvites,
  });
}
