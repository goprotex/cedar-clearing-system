/** Approx. overlap with Texas Hill Country / Edwards Plateau — used for regional priors. */
const HC_W = -99.85;
const HC_E = -96.75;
const HC_S = 29.25;
const HC_N = 31.45;

export function isCentralTexasHillCountry(bbox: number[]): boolean {
  const [w, s, e, n] = bbox;
  if (e < HC_W || w > HC_E || n < HC_S || s > HC_N) return false;
  return true;
}
