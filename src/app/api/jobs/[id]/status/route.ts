import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { canAccessJob } from '@/lib/job-access';
import { isCompanyAdmin } from '@/lib/company-admin';

const ALLOWED = new Set(['active', 'paused', 'completed', 'cancelled']);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Allow job owners, company admins (owner/manager), or users with canAccessJob
  const { data: membership, error: membershipErr } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });

  const isOwnerMember = membership?.role === 'owner';
  if (!isOwnerMember) {
    const adminCheck = await isCompanyAdmin(supabase, userId);
    if (!adminCheck) {
      const hasAccess = await canAccessJob(supabase, userId, jobId);
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden — job owners and company admins only' }, { status: 403 });
      }
    }
  }

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const status = typeof body.status === 'string' ? body.status.trim() : '';
  if (!ALLOWED.has(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const { error: upErr } = await supabase.from('jobs').update({ status }).eq('id', jobId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, status });
}
