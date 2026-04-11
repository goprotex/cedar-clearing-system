import type { SupabaseClient } from '@supabase/supabase-js';

export async function requireJobMember(
  supabase: SupabaseClient,
  jobId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const { data, error } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, message: error.message };
  if (!data) return { ok: false, status: 403, message: 'Forbidden' };
  return { ok: true };
}

export async function requireJobWorker(
  supabase: SupabaseClient,
  jobId: string,
  userId: string,
): Promise<{ ok: true; role: string } | { ok: false; status: number; message: string }> {
  const { data, error } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, message: error.message };
  if (!data) return { ok: false, status: 403, message: 'Forbidden' };
  if (data.role === 'viewer') return { ok: false, status: 403, message: 'Viewers cannot modify' };
  return { ok: true, role: data.role };
}
