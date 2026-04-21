import type { CedarAnalysis, CedarAnalysisSummary, CedarVegClass, TileConsensusStats } from '@/types';
import { CEDAR_GRID_SPACING_M, TARGET_SAMPLES_PER_CHUNK } from '@/lib/cedar-analysis-chunks';

function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** Remove duplicate analyzer grid cells that can appear on chunk boundaries. */
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

function applyTileConsensusToFeatures(
  features: GeoJSON.Feature[],
  gridSpacingM: number,
): { refined: GeoJSON.Feature[]; tileCount: number; consensusImprovedCells: number } {
  if (features.length < 4) {
    return { refined: features, tileCount: 0, consensusImprovedCells: 0 };
  }

  const centers = features
    .filter((f): f is GeoJSON.Feature<GeoJSON.Polygon> => f.geometry?.type === 'Polygon')
    .map((f) => {
      const coords = f.geometry.coordinates[0];
      const n = Math.max(1, coords.length - 1);
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < n; i++) {
        sx += coords[i][0];
        sy += coords[i][1];
      }
      return { lng: sx / n, lat: sy / n };
    });

  if (centers.length < 4) {
    return { refined: features, tileCount: 0, consensusImprovedCells: 0 };
  }

  const bbox: [number, number, number, number] = [
    Math.min(...centers.map((c) => c.lng)),
    Math.min(...centers.map((c) => c.lat)),
    Math.max(...centers.map((c) => c.lng)),
    Math.max(...centers.map((c) => c.lat)),
  ];

  const centerLat = (bbox[1] + bbox[3]) / 2;
  const spacingKm = gridSpacingM / 1000;
  const spacingLng = spacingKm / (111.32 * Math.cos((centerLat * Math.PI) / 180));
  const spacingLat = spacingKm / 111.32;

  type VegClass = CedarVegClass;
  interface IndexedFeature {
    feature: GeoJSON.Feature;
    col: number;
    row: number;
    originalIdx: number;
    classification: VegClass;
    confidence: number;
    bandVotes: number;
  }

  const indexed: IndexedFeature[] = features.map((feature, idx) => {
    if (feature.geometry?.type !== 'Polygon') {
      return {
        feature,
        col: -1,
        row: -1,
        originalIdx: idx,
        classification: ((feature.properties as { classification?: CedarVegClass })?.classification ?? 'bare') as VegClass,
        confidence: Number((feature.properties as { confidence?: number })?.confidence ?? 0),
        bandVotes: Number((feature.properties as { bandVotes?: number })?.bandVotes ?? 0),
      };
    }

    const coords = feature.geometry.coordinates[0];
    const n = Math.max(1, coords.length - 1);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += coords[i][0];
      sy += coords[i][1];
    }
    const lng = sx / n;
    const lat = sy / n;
    return {
      feature,
      col: Math.round((lng - bbox[0]) / spacingLng),
      row: Math.round((lat - bbox[1]) / spacingLat),
      originalIdx: idx,
      classification: ((feature.properties as { classification?: CedarVegClass })?.classification ?? 'bare') as VegClass,
      confidence: Number((feature.properties as { confidence?: number })?.confidence ?? 0),
      bandVotes: Number((feature.properties as { bandVotes?: number })?.bandVotes ?? 0),
    };
  });

  const gridMap = new Map<string, IndexedFeature>();
  let maxCol = 0;
  let maxRow = 0;
  for (const feature of indexed) {
    if (feature.col < 0 || feature.row < 0) continue;
    gridMap.set(`${feature.col},${feature.row}`, feature);
    if (feature.col > maxCol) maxCol = feature.col;
    if (feature.row > maxRow) maxRow = feature.row;
  }

  const pixelVotes: Array<Array<{ classification: VegClass; weight: number }>> = features.map(() => []);
  const tileRadius = 2;
  const stride = 2;
  let tileCount = 0;

  for (let tc = 0; tc <= maxCol; tc += stride) {
    for (let tr = 0; tr <= maxRow; tr += stride) {
      const tilePixels: IndexedFeature[] = [];
      for (let dc = -tileRadius; dc <= tileRadius; dc++) {
        for (let dr = -tileRadius; dr <= tileRadius; dr++) {
          const px = gridMap.get(`${tc + dc},${tr + dr}`);
          if (px) tilePixels.push(px);
        }
      }

      if (tilePixels.length < 2) continue;
      tileCount++;

      const classWeight: Record<VegClass, number> = {
        cedar: 0,
        oak: 0,
        mixed_brush: 0,
        grass: 0,
        bare: 0,
      };
      for (const px of tilePixels) {
        classWeight[px.classification] += px.confidence * (1 + px.bandVotes * 0.2);
      }

      let winner: VegClass = 'bare';
      let maxWeight = -1;
      for (const cls of Object.keys(classWeight) as VegClass[]) {
        if (classWeight[cls] > maxWeight) {
          maxWeight = classWeight[cls];
          winner = cls;
        }
      }

      const agreeing = tilePixels.filter((px) => px.classification === winner);
      const agreement = agreeing.length / tilePixels.length;
      const avgWinnerConfidence = agreeing.reduce((sum, px) => sum + px.confidence, 0) / Math.max(agreeing.length, 1);
      const voteWeight = avgWinnerConfidence * agreement;

      for (const px of tilePixels) {
        pixelVotes[px.originalIdx].push({ classification: winner, weight: voteWeight });
      }
    }
  }

  let consensusImprovedCells = 0;
  const refined = features.map((feature, idx) => {
    const votes = pixelVotes[idx];
    if (votes.length === 0) return feature;

    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const classWeight: Record<VegClass, number> = {
      cedar: 0,
      oak: 0,
      mixed_brush: 0,
      grass: 0,
      bare: 0,
    };
    for (const vote of votes) {
      classWeight[vote.classification] += vote.weight;
    }

    let bestClass = (props.classification as VegClass | undefined) ?? 'bare';
    let bestWeight = -1;
    for (const cls of Object.keys(classWeight) as VegClass[]) {
      if (classWeight[cls] > bestWeight) {
        bestWeight = classWeight[cls];
        bestClass = cls;
      }
    }

    const totalWeight = Object.values(classWeight).reduce((sum, weight) => sum + weight, 0);
    const winFraction = totalWeight > 0 ? bestWeight / totalWeight : 0;
    const originalClass = (props.classification as VegClass | undefined) ?? 'bare';
    const originalConfidence = Number(props.confidence ?? 0);

    if (bestClass !== originalClass) {
      consensusImprovedCells++;
      return {
        ...feature,
        properties: {
          ...props,
          classification: bestClass,
          confidence: Math.round(Math.min(0.95, originalConfidence * 0.3 + winFraction * 0.7) * 100) / 100,
        },
      };
    }

    return {
      ...feature,
      properties: {
        ...props,
        confidence: Math.round(Math.min(0.95, originalConfidence + winFraction * 0.15) * 100) / 100,
      },
    };
  });

  return { refined, tileCount, consensusImprovedCells };
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
        gridSpacingM: CEDAR_GRID_SPACING_M,
      },
    };
  }

  if (parts.length === 1) return parts[0];

  const mergedFeatures = dedupeGridFeatures(parts.flatMap((p) => p.gridCells.features));
  const total = mergedFeatures.length;
  const gridSpacingM = parts[0].summary.gridSpacingM ?? CEDAR_GRID_SPACING_M;

  const { refined: consensusFeatures, tileCount, consensusImprovedCells } = applyTileConsensusToFeatures(
    mergedFeatures,
    gridSpacingM,
  );

  const cedarCount = countClass(consensusFeatures, 'cedar');
  const oakCount = countClass(consensusFeatures, 'oak');
  const mixedCount = countClass(consensusFeatures, 'mixed_brush');
  const grassCount = countClass(consensusFeatures, 'grass');
  const bareCount = countClass(consensusFeatures, 'bare');

  const cedarPct = total > 0 ? cedarCount / total : 0;
  const highConf = consensusFeatures.filter(
    (f) =>
      (f.properties as { classification?: string; bandVotes?: number })?.classification === 'cedar' &&
      Number((f.properties as { bandVotes?: number }).bandVotes) >= 3
  ).length;

  const lowTrustCount = consensusFeatures.filter(
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
    averageNDVI: Math.round(avgProp(consensusFeatures, 'ndvi') * 1000) / 1000,
    averageGNDVI: Math.round(avgProp(consensusFeatures, 'gndvi') * 1000) / 1000,
    averageSAVI: Math.round(avgProp(consensusFeatures, 'savi') * 1000) / 1000,
    confidence: Math.round(avgProp(consensusFeatures, 'confidence') * 100),
    avgBandVotes: Math.round(avgProp(consensusFeatures, 'bandVotes') * 10) / 10,
    highConfidenceCedarCells: highConf,
    gridSpacingM,
    cellHalfLngDeg: base0.cellHalfLngDeg,
    cellHalfLatDeg: base0.cellHalfLatDeg,
    lowTrustCells: lowTrustCount,
    lowTrustPct: total > 0 ? Math.round((lowTrustCount / total) * 100) : 0,
    sentinelFusion: base0.sentinelFusion,
    tileConsensus: {
      tileCount,
      tileOverlapPct: 60,
      tileSizePixels: 5,
      tileSizeM: Math.round(gridSpacingM * 5),
      stridePixels: 2,
      strideM: Math.round(gridSpacingM * 2),
      consensusImprovedCells,
      consensusImprovedPct: total > 0 ? Math.round((consensusImprovedCells / total) * 100) : 0,
    },
    chunkedRun:
      parts.length > 1
        ? { chunkCount: parts.length, maxSamplesPerChunk: TARGET_SAMPLES_PER_CHUNK }
        : undefined,
  };

  return {
    gridCells: { type: 'FeatureCollection', features: consensusFeatures },
    summary,
  };
}
