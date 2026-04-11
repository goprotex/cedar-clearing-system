import type { SupabaseClient } from '@supabase/supabase-js';
import { getProfileCompanyContext, isCompanyAdminRole } from '@/lib/company-admin';
import { jobBidCompanyMatches } from '@/lib/job-company-access';

/** Job member, or company owner/manager for a company-linked bid. */
export async function canAccessJob(supabase: SupabaseClient, userId: string, jobId: string): Promise<boolean> {
  const { data: m } = await supabase
    .from('job_members')
    .select('job_id')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (m) return true;
  const ctx = await getProfileCompanyContext(supabase, userId);
  if (!ctx?.companyId || !isCompanyAdminRole(ctx.role)) return false;
  return jobBidCompanyMatches(supabase, jobId, ctx.companyId);
}
