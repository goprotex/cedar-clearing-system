import type { SupabaseClient } from '@supabase/supabase-js';

/** Profile roles that can manage company roster and job team (when also job owner). */
export const COMPANY_ADMIN_ROLES = ['owner', 'manager'] as const;

export async function getProfileCompanyContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ companyId: string | null; role: string | null } | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) return null;
  return { companyId: data?.company_id ?? null, role: data?.role ?? null };
}

export function isCompanyAdminRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

/** True if user is owner/manager with a company. */
export async function isCompanyAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const ctx = await getProfileCompanyContext(supabase, userId);
  return Boolean(ctx?.companyId && isCompanyAdminRole(ctx.role));
}
