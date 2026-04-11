import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

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

const STORE_PATH = join('/tmp', 'cedar-operator-positions.json');

function loadStore(): Record<string, OperatorData> {
  try {
    if (existsSync(STORE_PATH)) {
      return JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
    }
  } catch { /* corrupt file */ }
  return {};
}

function saveStore(data: Record<string, OperatorData>) {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(data));
  } catch { /* /tmp may be read-only in some envs */ }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { jobId, lng, lat, accuracy_m, heading_deg, heading, speed_mps, timestamp, trailPoint } = body as {
      jobId?: string; lng?: number; lat?: number;
      accuracy_m?: number | null; heading_deg?: number | null; heading?: number | null; speed_mps?: number | null;
      timestamp?: number; trailPoint?: [number, number];
    };

    if (!jobId || typeof lng !== 'number' || typeof lat !== 'number') {
      return NextResponse.json({ error: 'Missing jobId/lng/lat' }, { status: 400 });
    }

    const store = loadStore();
    const existing = store[jobId];
    const trail = existing?.trail ?? [];
    if (trailPoint && Array.isArray(trailPoint) && trailPoint.length >= 2) {
      trail.push(trailPoint);
      if (trail.length > 10000) trail.splice(0, trail.length - 10000);
    }

    const hdg = typeof heading === 'number' ? heading : heading_deg ?? null;
    store[jobId] = {
      jobId, lng, lat,
      accuracy_m: accuracy_m ?? null,
      heading_deg: hdg,
      speed_mps: speed_mps ?? null,
      timestamp: timestamp ?? Date.now(),
      trail,
    };

    saveStore(store);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobIds = url.searchParams.get('jobIds')?.split(',').filter(Boolean) ?? [];
  const store = loadStore();

  const result: Record<string, OperatorData> = {};
  if (jobIds.length > 0) {
    for (const id of jobIds) {
      if (store[id]) result[id] = store[id];
    }
  } else {
    Object.assign(result, store);
  }

  return NextResponse.json(result);
}
