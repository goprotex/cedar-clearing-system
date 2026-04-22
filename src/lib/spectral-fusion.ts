export type SpectralVegClass = 'cedar' | 'oak' | 'mixed_brush' | 'grass' | 'bare';

const TEXTURE_VAR_HIGH = 0.026;
const TEXTURE_VAR_EXTREME = 0.045;

/**
 * Combine NAIP classification, local NDVI texture, and Sentinel-2 summer/winter NDVI
 * (deciduous vs evergreen separation) for Central Texas woodlands.
 */
export function fuseNaipWithTextureAndSentinel(
  naipClass: SpectralVegClass,
  naipConfidence: number,
  textureNdviVar: number,
  winterNdvi: number | null,
  summerNdvi: number | null,
  opts: { hillCountry: boolean }
): {
  classification: SpectralVegClass;
  confidence: number;
  trustScore: number;
  lowTrust: boolean;
} {
  let cls: SpectralVegClass = naipClass;
  let conf = naipConfidence;

  const decidSignal =
    winterNdvi !== null && summerNdvi !== null ? summerNdvi - winterNdvi : null;
  const s2Mean =
    winterNdvi !== null && summerNdvi !== null ? (winterNdvi + summerNdvi) / 2 : null;

  let trust = 0.38 + naipConfidence * 0.48;

  const hc = opts.hillCountry;
  const decidStrong = decidSignal !== null && decidSignal > (hc ? 0.11 : 0.13);
  const decidWeak = decidSignal !== null && decidSignal < 0.055;
  const evergreenSignal =
    decidSignal !== null && decidWeak && s2Mean !== null && s2Mean > 0.26;
  const liveOakLikeSignal =
    hc && decidSignal !== null && decidSignal >= 0 && decidSignal < 0.08 && s2Mean !== null && s2Mean > 0.28;

  if (decidStrong) {
    if (naipClass === 'cedar') {
      cls = 'oak';
      conf = Math.min(0.72, naipConfidence + 0.18);
      trust += 0.06;
    } else if (naipClass === 'oak') {
      trust += 0.1;
    }
  } else if (evergreenSignal && naipClass === 'oak') {
    if (liveOakLikeSignal) {
      cls = 'oak';
      conf = Math.min(0.78, naipConfidence + 0.04);
      trust -= 0.04;
    } else {
      cls = 'cedar';
      conf = Math.min(0.68, naipConfidence + 0.05);
      trust -= 0.14;
    }
  } else if (liveOakLikeSignal && naipClass === 'mixed_brush') {
    cls = 'oak';
    conf = Math.min(0.64, naipConfidence + 0.08);
    trust += 0.02;
  } else if (evergreenSignal && naipClass === 'mixed_brush') {
    trust -= 0.06;
  }

  if (textureNdviVar > TEXTURE_VAR_EXTREME) {
    trust -= 0.2;
  } else if (textureNdviVar > TEXTURE_VAR_HIGH) {
    trust -= 0.12;
  }

  if (winterNdvi === null || summerNdvi === null) {
    trust -= 0.1;
  } else {
    trust += 0.04;
  }

  trust = Math.max(0.08, Math.min(0.96, trust));

  const lowTrust = trust < 0.5 || textureNdviVar > TEXTURE_VAR_HIGH;

  return {
    classification: cls,
    confidence: Math.round(conf * 100) / 100,
    trustScore: Math.round(trust * 100) / 100,
    lowTrust,
  };
}

/** Map full grid index → nearest subsample slot for S2 arrays. */
export function nearestSubsampleSlot(
  lng: number,
  lat: number,
  subsampleLngLat: Array<{ lng: number; lat: number }>
): number {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < subsampleLngLat.length; k++) {
    const p = subsampleLngLat[k];
    const d = (lng - p.lng) ** 2 + (lat - p.lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}
