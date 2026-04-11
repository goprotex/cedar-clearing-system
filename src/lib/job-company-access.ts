import type { SupabaseClient } from '@supabase/supabase-js';

/** True if job's bid belongs to the given company (bid_id is uuid text). */
export async function jobBidCompanyMatches(
  supabase: SupabaseClient,
  jobId: string,
  companyId: string,
): Promise<boolean> {
  const { data: job, error } = await supabase.from('jobs').select('bid_id').eq('id', jobId).maybeSingle();
  if (error || !job?.bid_id) return false;
  const { data: bid } = await supabase.from('bids').select('company_id').eq('id', job.bid_id).maybeSingle();
  return bid?.company_id === companyId;
}
