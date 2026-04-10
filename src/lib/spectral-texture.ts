/**
 * Local NDVI variance in a 3×3 neighborhood (same grid as 15 m spectral samples).
 * High variance ⇒ mixed pixels / edges ⇒ lower trust.
 */
export function computeLocalNdviVariance(
  points: Array<{ lng: number; lat: number; ndvi: number }>,
  bbox: number[],
  spacingKm: number
): number[] {
  const cLat = (bbox[1] + bbox[3]) / 2;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((cLat * Math.PI) / 180);
  const spacingLng = spacingKm / kmPerDegLng;
  const spacingLat = spacingKm / kmPerDegLat;
  const minLng = bbox[0];
  const minLat = bbox[1];

  const byColRow = new Map<string, number>();
  for (const p of points) {
    const col = Math.round((p.lng - minLng) / spacingLng);
    const row = Math.round((p.lat - minLat) / spacingLat);
    byColRow.set(`${col},${row}`, p.ndvi);
  }

  const out: number[] = [];
  for (const p of points) {
    const col = Math.round((p.lng - minLng) / spacingLng);
    const row = Math.round((p.lat - minLat) / spacingLat);
    const vals: number[] = [];
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const v = byColRow.get(`${col + dc},${row + dr}`);
        if (v !== undefined) vals.push(v);
      }
    }
    if (vals.length === 0) {
      out.push(0);
      continue;
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    out.push(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  }
  return out;
}
