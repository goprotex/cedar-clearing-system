import { normalizeCedarAnalysisPayload } from '@/lib/cedar-analysis-grid';
import type { CedarAnalysis } from '@/types';

/**
 * Reads the cedar-detect SSE stream (progress + final compact samples/summary).
 * Rejects on error event or missing result.
 */
export async function readCedarDetectSse(
  res: Response,
  onProgress?: (payload: Record<string, unknown>) => void
): Promise<CedarAnalysis> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Spectral analysis: no response body from server.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let resultData: CedarAnalysis | null = null;
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let eventType = '';
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ') && eventType) {
        try {
          const payload = JSON.parse(line.slice(6).trim()) as Record<string, unknown>;
          if (eventType === 'progress') {
            onProgress?.(payload);
          } else if (eventType === 'error') {
            streamError =
              typeof payload.message === 'string'
                ? payload.message
                : 'Spectral analysis failed on the server.';
          } else if (eventType === 'result') {
            resultData = normalizeCedarAnalysisPayload(payload);
          }
        } catch {
          /* skip malformed line */
        }
        eventType = '';
      }
    }
  }

  if (streamError) {
    throw new Error(streamError);
  }
  if (!resultData) {
    throw new Error(
      'No spectral result was received. Try a smaller pasture, check your connection, or retry — the analysis stream may have been cut off.'
    );
  }
  return resultData;
}

/** Map server 0–100 progress into a slice when multiple pasture chunks run sequentially. */
export function scaledChunkProgress(
  chunkIndex: number,
  chunkTotal: number,
  innerPct: number
): number {
  if (chunkTotal <= 1) {
    return Math.round(Math.min(100, Math.max(0, innerPct)));
  }
  const span = 82;
  const base = (chunkIndex / chunkTotal) * span;
  const within = (innerPct / 100) * (span / chunkTotal);
  return Math.min(94, Math.round(base + within));
}
