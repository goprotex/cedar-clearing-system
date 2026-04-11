import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { canAccessJob } from '@/lib/job-access';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canAccessJob(supabase, userId, jobId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    work_started_at?: string | null;
    work_completed_at?: string | null;
    manual_machine_hours?: number | null;
    manual_fuel_gallons?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if ('work_started_at' in body) {
    const v = body.work_started_at;
    updates.work_started_at = v === null || v === undefined || v === ''
      ? null
      : new Date(v).toISOString();
  }
  if ('work_completed_at' in body) {
    const v = body.work_completed_at;
    updates.work_completed_at = v === null || v === undefined || v === ''
      ? null
      : new Date(v).toISOString();
  }
  if ('manual_machine_hours' in body) {
    const v = body.manual_machine_hours;
    if (v === null || v === undefined) updates.manual_machine_hours = null;
    else {
      const n = Number(v);
      if (Number.isNaN(n) || n < 0) return NextResponse.json({ error: 'Invalid machine hours' }, { status: 400 });
      updates.manual_machine_hours = n;
    }
  }
  if ('manual_fuel_gallons' in body) {
    const v = body.manual_fuel_gallons;
    if (v === null || v === undefined) updates.manual_fuel_gallons = null;
    else {
      const n = Number(v);
      if (Number.isNaN(n) || n < 0) return NextResponse.json({ error: 'Invalid fuel amount' }, { status: 400 });
      updates.manual_fuel_gallons = n;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from('jobs')
    .update(updates)
    .eq('id', jobId)
    .select('id, work_started_at, work_completed_at, manual_machine_hours, manual_fuel_gallons')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ job: row });
}
