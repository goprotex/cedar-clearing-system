import * as turf from '@turf/turf';
import type { CedarAnalysis, CedarAnalysisSummary, CedarVegClass } from '@/types';
import { blobDiameterMeters, metersPerPixel, pixelToLngLat } from '@/lib/cir-object-detect';
import type { CirBlobFeatures } from '@/lib/cir-blob-features';
import { classifyCrownFromCirFeatures } from '@/lib/cir-crown-classify';

function squareCellAround(lng: number, lat: number, halfSizeM: number): GeoJSON.Position[][] {
  const km = halfSizeM / 1000;
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [
    [
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ],
  ];
}

function classColor(c: CedarVegClass): string {
  switch (c) {
    case 'cedar':
      return '#f97316';
    case 'oak':
      return '#fbbf24';
    case 'mixed_brush':
      return '#84cc16';
    default:
      return '#94a3b8';
  }
}

/**
 * Build CedarAnalysis from CIR blob features (object path: indices + texture + multi-scale context).
 * Each blob → one grid cell; species from fused classifier.
 */
export function buildCedarAnalysisFromCirBlobs(
  blobs: CirBlobFeatures[],
  polygonCoords: GeoJSON.Position[][],
  pastureAcreage: number,
  imageW: number,
  imageH: number,
  bbox: [number, number, number, number]
): CedarAnalysis {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const pasture = turf.polygon(polygonCoords);
  const mpp = metersPerPixel(minLng, maxLng, minLat, maxLat, imageW, imageH);

  type Row = {
    lng: number;
    lat: number;
    dM: number;
    pixels: number;
    feat: CirBlobFeatures;
    classification: CedarVegClass;
    conf: number;
    votes: number;
  };

  const inside: Row[] = [];
  for (const b of blobs) {
    const [lng, lat] = pixelToLngLat(b.centroidXPx, b.centroidYPx, imageW, imageH, minLng, minLat, maxLng, maxLat);
    const pt = turf.point([lng, lat]);
    if (!turf.booleanPointInPolygon(pt, pasture)) continue;
    const dM = blobDiameterMeters(b.pixelCount, mpp);
    const { classification, confidence, bandVotes } = classifyCrownFromCirFeatures(b);
    inside.push({
      lng,
      lat,
      dM,
      pixels: b.pixelCount,
      feat: b,
      classification,
      conf: confidence,
      votes: bandVotes,
    });
  }

  const total = inside.length;
  if (total === 0) {
    const emptySummary: CedarAnalysisSummary = {
      totalSamples: 0,
      cedar: { count: 0, pct: 0 },
      oak: { count: 0, pct: 0 },
      mixedBrush: { count: 0, pct: 0 },
      grass: { count: 0, pct: 0 },
      bare: { count: 0, pct: 0 },
      estimatedCedarAcres: 0,
      averageNDVI: 0,
      averageGNDVI: 0,
      averageSAVI: 0,
      confidence: 0,
      avgBandVotes: 0,
      highConfidenceCedarCells: 0,
      gridSpacingM: Math.round(mpp * 10) / 10,
      detectionMode: 'cir_objects',
      objectDetectionCount: 0,
    };
    return { gridCells: { type: 'FeatureCollection', features: [] }, summary: emptySummary };
  }
  const countClass = (c: CedarVegClass) => inside.filter((r) => r.classification === c).length;
  const cedarN = countClass('cedar');
  const oakN = countClass('oak');
  const mixedN = countClass('mixed_brush');

  const crownAreaM2ForCedar = inside
    .filter((r) => r.classification === 'cedar' || r.classification === 'mixed_brush')
    .reduce((s, r) => {
      const frac = r.classification === 'mixed_brush' ? 0.5 : 1;
      return s + frac * Math.PI * (r.dM / 2) ** 2;
    }, 0);
  const estimatedCedarAcres = Math.min(
    pastureAcreage,
    Math.round((crownAreaM2ForCedar / 4047) * 10) / 10
  );

  const halfCellM = Math.max(4, mpp * 3);

  const features: GeoJSON.Feature[] = inside.map((r) => {
    const f = r.feat;
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: squareCellAround(r.lng, r.lat, halfCellM),
      },
      properties: {
        classification: r.classification,
        ndvi: Math.round(f.ndvi * 1000) / 1000,
        gndvi: Math.round(f.gndvi * 1000) / 1000,
        savi: Math.round(f.savi * 1000) / 1000,
        confidence: r.conf / 100,
        bandVotes: r.votes,
        color: classColor(r.classification),
        detectionMethod: 'cir_objects',
        canopyDiameterM: r.dM,
        heightM:
          r.classification === 'oak'
            ? Math.min(18, 5 + r.dM * 0.5)
            : Math.min(14, 4 + r.dM * 0.45),
        blobPixels: r.pixels,
        ndviStd: Math.round(f.ndviStd * 1000) / 1000,
        cellNdvi60m: Math.round(f.cellNdvi60m * 1000) / 1000,
        isolationVs60m: Math.round(f.isolationVs60m * 1000) / 1000,
      },
    };
  });

  const avg = (fn: (x: CirBlobFeatures) => number) =>
    inside.length ? inside.reduce((s, r) => s + fn(r.feat), 0) / inside.length : 0;
  const avgConf =
    inside.length > 0 ? Math.round(inside.reduce((s, r) => s + r.conf, 0) / inside.length) : 0;
  const avgVotes =
    inside.length > 0
      ? Math.round((inside.reduce((s, r) => s + r.votes, 0) / inside.length) * 10) / 10
      : 0;
  const highConfCedar = inside.filter((r) => r.classification === 'cedar' && r.conf >= 65).length;

  const summary: CedarAnalysisSummary = {
    totalSamples: total,
    cedar: { count: cedarN, pct: total > 0 ? Math.round((cedarN / total) * 100) : 0 },
    oak: { count: oakN, pct: total > 0 ? Math.round((oakN / total) * 100) : 0 },
    mixedBrush: { count: mixedN, pct: total > 0 ? Math.round((mixedN / total) * 100) : 0 },
    grass: { count: 0, pct: 0 },
    bare: { count: 0, pct: 0 },
    estimatedCedarAcres: total > 0 ? estimatedCedarAcres : 0,
    averageNDVI: Math.round(avg((b) => b.ndvi) * 1000) / 1000,
    averageGNDVI: Math.round(avg((b) => b.gndvi) * 1000) / 1000,
    averageSAVI: Math.round(avg((b) => b.savi) * 1000) / 1000,
    confidence: avgConf,
    avgBandVotes: avgVotes,
    highConfidenceCedarCells: highConfCedar,
    gridSpacingM: Math.round(mpp * 10) / 10,
    detectionMode: 'cir_objects',
    objectDetectionCount: total,
  };

  return {
    gridCells: { type: 'FeatureCollection', features },
    summary,
  };
}
