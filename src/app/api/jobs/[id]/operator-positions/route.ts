import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);

  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Ensure membership
  const { data: membership, error: membershipErr } = await supabase
    .from('job_members')
    .select('job_id')
    .eq('job_id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase
    .from('job_operator_positions')
    .select('job_id, user_id, updated_at, lng, lat, accuracy_m, heading, speed_mps')
    .eq('job_id', id)
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ positions: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);

  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Ensure membership
  const { data: membership, error: membershipErr } = await supabase
    .from('job_members')
    .select('job_id')
    .eq('job_id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const b = body as Partial<{
    lng: number;
    lat: number;
    accuracy_m: number | null;
    heading: number | null;
    heading_deg: number | null;
    speed_mps: number | null;
  }> | null;

  if (!b || typeof b.lng !== 'number' || typeof b.lat !== 'number') {
    return NextResponse.json({ error: 'Missing lng/lat' }, { status: 400 });
  }

  // DB column is `heading`; accept both `heading` and `heading_deg` from clients.
  const heading =
    typeof b.heading === 'number' ? b.heading
      : typeof b.heading_deg === 'number' ? b.heading_deg : null;

  const { error: upsertErr } = await supabase.from('job_operator_positions').upsert({
    job_id: id,
    user_id: userId,
    lng: b.lng,
    lat: b.lat,
    accuracy_m: b.accuracy_m ?? null,
    heading,
    speed_mps: b.speed_mps ?? null,
  }, { onConflict: 'job_id,user_id' });
  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

