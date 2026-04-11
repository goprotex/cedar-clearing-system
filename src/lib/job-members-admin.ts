import type { SupabaseClient } from '@supabase/supabase-js';
import { getProfileCompanyContext, isCompanyAdminRole } from '@/lib/company-admin';
import { jobBidCompanyMatches } from '@/lib/job-company-access';

/** Job per-job owner, or company owner/manager for company-linked bids. */
export async function canManageJobMembers(
  supabase: SupabaseClient,
  jobId: string,
  userId: string,
): Promise<boolean> {
  const { data: me } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (me?.role === 'owner') return true;
  const ctx = await getProfileCompanyContext(supabase, userId);
  if (!ctx?.companyId || !isCompanyAdminRole(ctx.role)) return false;
  return jobBidCompanyMatches(supabase, jobId, ctx.companyId);
}
