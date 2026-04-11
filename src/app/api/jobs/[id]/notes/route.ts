import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { canAccessJob } from '@/lib/job-access';

export type NoteAttachment = { url: string; kind?: 'image' | 'pdf'; name?: string };

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canAccessJob(supabase, userId, jobId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: notes, error } = await supabase
    .from('job_notes')
    .select('id, job_id, created_by, created_at, updated_at, body, attachments')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ notes: notes ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canAccessJob(supabase, userId, jobId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { body?: string; attachments?: NoteAttachment[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (!text && attachments.length === 0) {
    return NextResponse.json({ error: 'Note text or at least one attachment required' }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from('job_notes')
    .insert({
      job_id: jobId,
      created_by: userId,
      body: text,
      attachments: attachments as unknown as Record<string, unknown>,
    })
    .select('id, job_id, created_by, created_at, updated_at, body, attachments')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ note: row });
}
