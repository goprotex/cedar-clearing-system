import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireJobWorker } from '@/lib/job-api-auth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('job_members')
    .select('job_id')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase.from('job_schedule_blocks').select('*').eq('job_id', jobId).order('starts_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ blocks: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gate = await requireJobWorker(supabase, jobId, userId);
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  let body: { starts_at?: string; ends_at?: string; title?: string; notes?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.starts_at || !body.ends_at) {
    return NextResponse.json({ error: 'starts_at and ends_at required' }, { status: 400 });
  }
  const starts = Date.parse(body.starts_at);
  const ends = Date.parse(body.ends_at);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('job_schedule_blocks')
    .insert({
      job_id: jobId,
      starts_at: new Date(starts).toISOString(),
      ends_at: new Date(ends).toISOString(),
      title: (body.title ?? 'Scheduled block').slice(0, 200),
      notes: body.notes?.slice(0, 2000) ?? null,
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ block: data });
}
