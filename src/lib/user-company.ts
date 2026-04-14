import type { SupabaseClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';

/** Current user's company from profiles (null = personal / no company yet). */
export async function getUserCompanyId(
  supabase: SupabaseClient,
  request?: Request,
): Promise<{ userId: string; companyId: string | null } | null> {
  const bearerFromRequest = request?.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const headersList = await headers();
  const bearerFromNext = headersList.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const bearer = bearerFromRequest ?? bearerFromNext;

  const { data: auth, error: authErr } = bearer
    ? await supabase.auth.getUser(bearer)
    : await supabase.auth.getUser();
  if (authErr || !auth.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', auth.user.id)
    .maybeSingle();

  return { userId: auth.user.id, companyId: profile?.company_id ?? null };
}
