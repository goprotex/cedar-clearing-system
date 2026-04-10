import type { CedarAnalysis, CedarAnalysisSummary, CedarVegClass, TileConsensusStats } from '@/types';

function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** Remove duplicate 15 m grid cells that can appear on chunk boundaries. */
function dedupeGridFeatures(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const seen = new Set<string>();
  const out: GeoJSON.Feature[] = [];
  for (const f of features) {
    if (f.geometry?.type !== 'Polygon') {
      out.push(f);
      continue;
    }
    const coords = f.geometry.coordinates[0];
    if (!coords?.length) continue;
    let sx = 0;
    let sy = 0;
    for (const c of coords) {
      sx += c[0];
      sy += c[1];
    }
    const cx = sx / coords.length;
    const cy = sy / coords.length;
    const key = `${roundCoord(cx)},${roundCoord(cy)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function countClass(features: GeoJSON.Feature[], c: CedarVegClass): number {
  return features.filter((f) => (f.properties as { classification?: string })?.classification === c).length;
}

function avgProp(features: GeoJSON.Feature[], key: string): number {
  if (features.length === 0) return 0;
  const sum = features.reduce((s, f) => s + Number((f.properties as Record<string, number>)?.[key] ?? 0), 0);
  return sum / features.length;
}

function sumTileConsensus(parts: CedarAnalysis[]): TileConsensusStats | undefined {
  const withTc = parts.filter((p) => p.summary.tileConsensus);
  if (withTc.length === 0) return undefined;
  let tileCount = 0;
  let consensusImprovedCells = 0;
  for (const p of withTc) {
    const t = p.summary.tileConsensus!;
    tileCount += t.tileCount;
    consensusImprovedCells += t.consensusImprovedCells;
  }
  const first = withTc[0].summary.tileConsensus!;
  const total = parts.reduce((s, p) => s + p.summary.totalSamples, 0);
  return {
    ...first,
    tileCount,
    consensusImprovedCells,
    consensusImprovedPct: total > 0 ? Math.round((consensusImprovedCells / total) * 100) : 0,
  };
}

/** Merge multiple chunk responses into one analysis for the full pasture. */
export function mergeCedarAnalyses(parts: CedarAnalysis[], pastureAcreage: number): CedarAnalysis {
  if (parts.length === 0) {
    return {
      gridCells: { type: 'FeatureCollection', features: [] },
      summary: {
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
        gridSpacingM: 15,
      },
    };
  }

  if (parts.length === 1) return parts[0];

  const mergedFeatures = dedupeGridFeatures(parts.flatMap((p) => p.gridCells.features));
  const total = mergedFeatures.length;

  const cedarCount = countClass(mergedFeatures, 'cedar');
  const oakCount = countClass(mergedFeatures, 'oak');
  const mixedCount = countClass(mergedFeatures, 'mixed_brush');
  const grassCount = countClass(mergedFeatures, 'grass');
  const bareCount = countClass(mergedFeatures, 'bare');

  const cedarPct = total > 0 ? cedarCount / total : 0;
  const highConf = mergedFeatures.filter(
    (f) =>
      (f.properties as { classification?: string; bandVotes?: number })?.classification === 'cedar' &&
      Number((f.properties as { bandVotes?: number }).bandVotes) >= 3
  ).length;

  const gridSpacingM = parts[0].summary.gridSpacingM ?? 15;
  const lowTrustCount = mergedFeatures.filter(
    (f) => Boolean((f.properties as { lowTrust?: boolean }).lowTrust)
  ).length;
  const base0 = parts[0].summary;

  const summary: CedarAnalysisSummary = {
    totalSamples: total,
    cedar: { count: cedarCount, pct: total > 0 ? Math.round(cedarPct * 100) : 0 },
    oak: { count: oakCount, pct: total > 0 ? Math.round((oakCount / total) * 100) : 0 },
    mixedBrush: { count: mixedCount, pct: total > 0 ? Math.round((mixedCount / total) * 100) : 0 },
    grass: { count: grassCount, pct: total > 0 ? Math.round((grassCount / total) * 100) : 0 },
    bare: { count: bareCount, pct: total > 0 ? Math.round((bareCount / total) * 100) : 0 },
    estimatedCedarAcres: Math.round(cedarPct * pastureAcreage * 10) / 10,
    averageNDVI: Math.round(avgProp(mergedFeatures, 'ndvi') * 1000) / 1000,
    averageGNDVI: Math.round(avgProp(mergedFeatures, 'gndvi') * 1000) / 1000,
    averageSAVI: Math.round(avgProp(mergedFeatures, 'savi') * 1000) / 1000,
    confidence: Math.round(avgProp(mergedFeatures, 'confidence') * 100),
    avgBandVotes: Math.round(avgProp(mergedFeatures, 'bandVotes') * 10) / 10,
    highConfidenceCedarCells: highConf,
    gridSpacingM,
    cellHalfLngDeg: base0.cellHalfLngDeg,
    cellHalfLatDeg: base0.cellHalfLatDeg,
    lowTrustCells: lowTrustCount,
    lowTrustPct: total > 0 ? Math.round((lowTrustCount / total) * 100) : 0,
    sentinelFusion: base0.sentinelFusion,
    tileConsensus: sumTileConsensus(parts),
  };

  return {
    gridCells: { type: 'FeatureCollection', features: mergedFeatures },
    summary,
  };
}
