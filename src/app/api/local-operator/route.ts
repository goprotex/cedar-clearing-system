import { NextResponse } from 'next/server';

type OperatorData = {
  jobId: string;
  lng: number;
  lat: number;
  accuracy_m: number | null;
  heading_deg: number | null;
  speed_mps: number | null;
  timestamp: number;
  trail: [number, number][];
};

// In-memory store keyed by jobId. Resets on server restart, which is fine
// for local/demo usage. Production would use Supabase Realtime instead.
const store = new Map<string, OperatorData>();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { jobId, lng, lat, accuracy_m, heading_deg, speed_mps, timestamp, trailPoint } = body as {
      jobId?: string; lng?: number; lat?: number;
      accuracy_m?: number | null; heading_deg?: number | null; speed_mps?: number | null;
      timestamp?: number; trailPoint?: [number, number];
    };

    if (!jobId || typeof lng !== 'number' || typeof lat !== 'number') {
      return NextResponse.json({ error: 'Missing jobId/lng/lat' }, { status: 400 });
    }

    const existing = store.get(jobId);
    const trail = existing?.trail ?? [];
    if (trailPoint && Array.isArray(trailPoint) && trailPoint.length >= 2) {
      trail.push(trailPoint);
      // Cap trail length to prevent memory bloat
      if (trail.length > 10000) trail.splice(0, trail.length - 10000);
    }

    store.set(jobId, {
      jobId,
      lng, lat,
      accuracy_m: accuracy_m ?? null,
      heading_deg: heading_deg ?? null,
      speed_mps: speed_mps ?? null,
      timestamp: timestamp ?? Date.now(),
      trail,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobIds = url.searchParams.get('jobIds')?.split(',').filter(Boolean) ?? [];

  const result: Record<string, OperatorData> = {};
  if (jobIds.length > 0) {
    for (const id of jobIds) {
      const data = store.get(id);
      if (data) result[id] = data;
    }
  } else {
    for (const [id, data] of store) {
      result[id] = data;
    }
  }

  return NextResponse.json(result);
}
