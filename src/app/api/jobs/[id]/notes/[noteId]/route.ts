import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { canAccessJob } from '@/lib/job-access';
import type { NoteAttachment } from '../route';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id: jobId, noteId } = await params;
  const supabase = await createClient(req);
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

  const updates: Record<string, unknown> = {};
  if (typeof body.body === 'string') updates.body = body.body;
  if (Array.isArray(body.attachments)) updates.attachments = body.attachments;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from('job_notes')
    .update(updates)
    .eq('id', noteId)
    .eq('job_id', jobId)
    .select('id, job_id, created_by, created_at, updated_at, body, attachments')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ note: row });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id: jobId, noteId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canAccessJob(supabase, userId, jobId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await supabase.from('job_notes').delete().eq('id', noteId).eq('job_id', jobId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
