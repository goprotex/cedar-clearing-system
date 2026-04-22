import { NextResponse } from 'next/server';

import { OVERLAY_LAYERS, type OverlayLayerKey } from '@/lib/map-layers';

const DYNAMIC_OVERLAY_DEFS = OVERLAY_LAYERS.filter(
  (candidate) => candidate.sourceType === 'dynamic-geojson',
);

const DYNAMIC_OVERLAY_KEYS = new Set<OverlayLayerKey>(
  DYNAMIC_OVERLAY_DEFS.map((candidate) => candidate.key),
);

function sanitizeFeatureCollection(input: unknown): GeoJSON.FeatureCollection {
  if (!input || typeof input !== 'object') {
    return { type: 'FeatureCollection', features: [] };
  }

  const maybeFeatures = (input as { features?: unknown }).features;
  if (!Array.isArray(maybeFeatures)) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features = maybeFeatures.flatMap((feature): GeoJSON.Feature[] => {
    if (!feature || typeof feature !== 'object') return [];

    const candidate = feature as {
      type?: unknown;
      id?: unknown;
      geometry?: unknown;
      properties?: unknown;
    };

    if (candidate.type !== 'Feature' || !candidate.geometry || typeof candidate.geometry !== 'object') {
      return [];
    }

    return [{
      type: 'Feature',
      id: typeof candidate.id === 'string' || typeof candidate.id === 'number' ? candidate.id : undefined,
      geometry: candidate.geometry as GeoJSON.Geometry,
      properties:
        candidate.properties && typeof candidate.properties === 'object'
          ? (candidate.properties as GeoJSON.GeoJsonProperties)
          : {},
    }];
  });

  return { type: 'FeatureCollection', features };
}

function parseBbox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;

  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;

  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;

  return [west, south, east, north];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const layer = searchParams.get('layer') as OverlayLayerKey | null;
  const bbox = parseBbox(searchParams.get('bbox'));

  if (!layer || !DYNAMIC_OVERLAY_KEYS.has(layer)) {
    return NextResponse.json(
      { error: 'Invalid overlay layer.' },
      { status: 400 },
    );
  }

  if (!bbox) {
    return NextResponse.json(
      { error: 'Invalid or missing bbox.' },
      { status: 400 },
    );
  }

  const def = DYNAMIC_OVERLAY_DEFS.find((candidate) => candidate.key === layer);
  if (!def?.serviceUrl) {
    return NextResponse.json(
      { error: 'Overlay layer is not configured.' },
      { status: 404 },
    );
  }

  const [west, south, east, north] = bbox;
  const params = new URLSearchParams({
    where: def.queryWhere ?? '1=1',
    returnGeometry: 'true',
    outFields: '*',
    f: 'geojson',
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outSR: '4326',
    geometry: `${west},${south},${east},${north}`,
  });

  try {
    const response = await fetch(`${def.serviceUrl}/query?${params.toString()}`, {
      headers: {
        accept: 'application/json',
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream overlay request failed with ${response.status}.` },
        { status: 502 },
      );
    }

    const data = sanitizeFeatureCollection(await response.json());

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load overlay layer.' },
      { status: 502 },
    );
  }
}