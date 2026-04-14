import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import { requireJobWorker } from '@/lib/job-api-auth';
import { canAccessJob } from '@/lib/job-access';

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gate = await requireJobWorker(supabase, jobId, userId);
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  let body: {
    points?: [number, number][];
    source?: string;
    label?: string;
    started_at?: string;
    ended_at?: string | null;
    cutting_width_ft?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const points = Array.isArray(body.points) ? body.points : [];
  const clean: [number, number][] = [];
  for (const p of points) {
    if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      clean.push([p[0], p[1]]);
    }
  }

  let distance_m = 0;
  for (let i = 1; i < clean.length; i++) {
    distance_m += haversineM(clean[i - 1], clean[i]);
  }

  const widthFt = typeof body.cutting_width_ft === 'number' && body.cutting_width_ft > 0 ? body.cutting_width_ft : 6;
  const widthM = widthFt * 0.3048;
  const areaSqM = distance_m * widthM * 0.85;
  const area_acres_estimate = areaSqM / 4046.86;

  const source =
    body.source === 'import' || body.source === 'manual' ? body.source : 'phone';

  const { data, error } = await supabase
    .from('job_gps_tracks')
    .insert({
      job_id: jobId,
      operator_id: userId,
      source,
      started_at: body.started_at ?? new Date().toISOString(),
      ended_at: body.ended_at ?? new Date().toISOString(),
      points: clean,
      distance_m: clean.length >= 2 ? distance_m : null,
      area_acres_estimate: clean.length >= 2 ? Math.round(area_acres_estimate * 100) / 100 : null,
      label: body.label?.slice(0, 200) ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ gpsTrack: data });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canAccessJob(supabase, userId, jobId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('job_gps_tracks')
    .select(
      'id, job_id, operator_id, source, label, started_at, ended_at, points, distance_m, area_acres_estimate, created_at'
    )
    .eq('job_id', jobId)
    .order('started_at', { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tracks: data ?? [] });
}
