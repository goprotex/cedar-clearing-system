import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * Company roster for the signed-in user's organization.
 * Requires a valid Supabase session cookie; otherwise 401 (fixes client console noise
 * when this route was missing or unauthenticated requests were forwarded blindly).
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized', profiles: [] }, { status: 401 });
  }

  const { data: selfRow, error: selfErr } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle();

  if (selfErr) {
    return NextResponse.json({ error: selfErr.message }, { status: 500 });
  }

  if (!selfRow?.company_id) {
    return NextResponse.json({
      company_id: null,
      profiles: [],
    });
  }

  const { data: profiles, error: listErr } = await supabase
    .from('profiles')
    .select('id, full_name, role, phone, company_id, avatar_url, created_at, updated_at')
    .eq('company_id', selfRow.company_id)
    .order('full_name', { ascending: true });

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  return NextResponse.json({
    company_id: selfRow.company_id,
    profiles: profiles ?? [],
  });
}
