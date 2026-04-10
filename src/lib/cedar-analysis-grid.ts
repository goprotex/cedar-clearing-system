import type { CedarAnalysis, CedarAnalysisSummary } from '@/types';

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
          [
            [s.lng - halfLngDeg, s.lat - halfLatDeg],
            [s.lng + halfLngDeg, s.lat - halfLatDeg],
            [s.lng + halfLngDeg, s.lat + halfLatDeg],
            [s.lng - halfLngDeg, s.lat + halfLatDeg],
            [s.lng - halfLngDeg, s.lat - halfLatDeg],
          ],
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

  if (Array.isArray(payload.samples)) {
    let halfLng = summary.cellHalfLngDeg;
    let halfLat = summary.cellHalfLatDeg;
    if (halfLng == null || halfLat == null) {
      const m = summary.gridSpacingM / 2;
      halfLat = m / 111_320;
      halfLng = m / 111_320;
    }
    const gridCells = samplesToGridCells(payload.samples as SpectralSamplePayload[], halfLng, halfLat);
    return { summary, gridCells };
  }

  const gridCells = payload.gridCells as GeoJSON.FeatureCollection | undefined;
  if (gridCells && gridCells.type === 'FeatureCollection') {
    return { summary, gridCells };
  }

  return null;
}
