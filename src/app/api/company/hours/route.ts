import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isCompanyAdmin } from '@/lib/company-admin';

export type EmployeeHoursSummary = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  total_hours: number;
  job_count: number;
};

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await isCompanyAdmin(supabase, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: me } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', userId)
    .maybeSingle();
  const companyId = me?.company_id;
  if (!companyId) return NextResponse.json({ hours: [] as EmployeeHoursSummary[] });

  // Get all profiles in the company
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('company_id', companyId);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const profileIds = (profiles ?? []).map((p) => p.id as string);
  if (profileIds.length === 0) return NextResponse.json({ hours: [] as EmployeeHoursSummary[] });

  // Get all time entries for these users
  const { data: entries, error: teErr } = await supabase
    .from('job_time_entries')
    .select('user_id, clock_in, clock_out, manual_hours, job_id')
    .in('user_id', profileIds);
  if (teErr) return NextResponse.json({ error: teErr.message }, { status: 500 });

  // Aggregate hours per user
  const hoursMap = new Map<string, { hours: number; jobIds: Set<string> }>();
  for (const e of entries ?? []) {
    const uid = e.user_id as string;
    if (!hoursMap.has(uid)) hoursMap.set(uid, { hours: 0, jobIds: new Set() });
    const agg = hoursMap.get(uid)!;
    if (e.job_id) agg.jobIds.add(e.job_id as string);
    if (typeof e.manual_hours === 'number' && e.manual_hours > 0) {
      agg.hours += e.manual_hours as number;
    } else if (e.clock_in && e.clock_out) {
      const diffMs = new Date(e.clock_out as string).getTime() - new Date(e.clock_in as string).getTime();
      if (diffMs > 0) agg.hours += diffMs / (1000 * 60 * 60);
    }
  }

  const profileMap = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string | null]));

  const hours: EmployeeHoursSummary[] = profileIds.map((id) => {
    const agg = hoursMap.get(id);
    return {
      user_id: id,
      email: null,
      full_name: profileMap.get(id) ?? null,
      total_hours: agg ? Math.round(agg.hours * 10) / 10 : 0,
      job_count: agg ? agg.jobIds.size : 0,
    };
  }).sort((a, b) => b.total_hours - a.total_hours);

  return NextResponse.json({ hours });
}
