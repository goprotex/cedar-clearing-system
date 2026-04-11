import type { SupabaseClient } from '@supabase/supabase-js';

/** Current user's company from profiles (null = personal / no company yet). */
export async function getUserCompanyId(
  supabase: SupabaseClient
): Promise<{ userId: string; companyId: string | null } | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', auth.user.id)
    .maybeSingle();

  return { userId: auth.user.id, companyId: profile?.company_id ?? null };
}
