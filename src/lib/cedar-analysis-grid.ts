import type { CedarAnalysis, CedarAnalysisSummary, CrownDetection, CrownMaskFeatureProperties } from '@/types';

/** Compact spectral cell from the API stream (avoids huge GeoJSON over SSE). */
export interface SpectralSamplePayload {
  lng: number;
  lat: number;
  ndvi: number;
  gndvi: number;
  savi: number;
  classification: string;
  confidence: number;
  bandVotes: number;
  trustScore?: number;
  lowTrust?: boolean;
}

function spectralCellColor(classification: string, ndvi: number): string {
  switch (classification) {
    case 'cedar':
      if (ndvi > 0.5) return '#dc2626';
      if (ndvi > 0.4) return '#ea580c';
      return '#f97316';
    case 'oak':
      return '#92400e';
    case 'mixed_brush':
      return '#d97706';
    case 'grass':
      return '#65a30d';
    case 'bare':
      return '#9ca3af';
    default:
      return '#9ca3af';
  }
}

function seededUnit(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function seedFromPoint(lng: number, lat: number): number {
  return Math.round(lng * 1e6) * 0.0001 + Math.round(lat * 1e6) * 0.0002;
}

function buildIrregularCellRing(
  lng: number,
  lat: number,
  halfLngDeg: number,
  halfLatDeg: number,
): GeoJSON.Position[] {
  const minLng = lng - halfLngDeg;
  const maxLng = lng + halfLngDeg;
  const minLat = lat - halfLatDeg;
  const maxLat = lat + halfLatDeg;
  const width = halfLngDeg * 2;
  const height = halfLatDeg * 2;
  const seed = seedFromPoint(lng, lat);
  const inset = (n: number, min: number, max: number) => min + seededUnit(seed + n) * (max - min);

  const tlx = inset(1, width * 0.12, width * 0.3);
  const trx = inset(2, width * 0.12, width * 0.3);
  const tryInset = inset(3, height * 0.12, height * 0.3);
  const bryInset = inset(4, height * 0.12, height * 0.3);
  const brx = inset(5, width * 0.12, width * 0.3);
  const blx = inset(6, width * 0.12, width * 0.3);
  const blyInset = inset(7, height * 0.12, height * 0.3);
  const tlyInset = inset(8, height * 0.12, height * 0.3);

  return [
    [minLng + tlx, minLat],
    [maxLng - trx, minLat],
    [maxLng, minLat + tryInset],
    [maxLng, maxLat - bryInset],
    [maxLng - brx, maxLat],
    [minLng + blx, maxLat],
    [minLng, maxLat - blyInset],
    [minLng, minLat + tlyInset],
    [minLng + tlx, minLat],
  ];
}

/** Rebuild GeoJSON grid cells from compact samples + cell half-extents (matches server geometry). */
export function samplesToGridCells(
  samples: SpectralSamplePayload[],
  halfLngDeg: number,
  halfLatDeg: number
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: samples.map((s) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          buildIrregularCellRing(s.lng, s.lat, halfLngDeg, halfLatDeg),
        ],
      },
      properties: {
        classification: s.classification,
        ndvi: Math.round(s.ndvi * 1000) / 1000,
        gndvi: Math.round(s.gndvi * 1000) / 1000,
        savi: Math.round(s.savi * 1000) / 1000,
        confidence: Math.round(s.confidence * 100) / 100,
        bandVotes: s.bandVotes,
        trustScore: s.trustScore,
        lowTrust: s.lowTrust ?? false,
        color: s.lowTrust ? '#ea580c' : spectralCellColor(s.classification, s.ndvi),
      },
    })),
  };
}

/** Build full `CedarAnalysis` from streamed `summary` + `samples` (preferred) or pass-through legacy `gridCells`. */
export function normalizeCedarAnalysisPayload(payload: Record<string, unknown>): CedarAnalysis | null {
  const summary = payload.summary as CedarAnalysisSummary | undefined;
  if (!summary) return null;
  const crowns = Array.isArray(payload.crowns) ? (payload.crowns as CrownDetection[]) : undefined;
  const crownMasks = payload.crownMasks as GeoJSON.FeatureCollection<GeoJSON.Polygon, CrownMaskFeatureProperties> | undefined;

  if (Array.isArray(payload.samples)) {
    let halfLng = summary.cellHalfLngDeg;
    let halfLat = summary.cellHalfLatDeg;
    if (halfLng == null || halfLat == null) {
      const m = summary.gridSpacingM / 2;
      halfLat = m / 111_320;
      halfLng = m / 111_320;
    }
    const gridCells = samplesToGridCells(payload.samples as SpectralSamplePayload[], halfLng, halfLat);
    return { summary, gridCells, crowns, crownMasks };
  }

  const gridCells = payload.gridCells as GeoJSON.FeatureCollection | undefined;
  if (gridCells && gridCells.type === 'FeatureCollection') {
    return { summary, gridCells, crowns, crownMasks };
  }

  return null;
}
