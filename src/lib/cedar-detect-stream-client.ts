import { normalizeCedarAnalysisPayload } from '@/lib/cedar-analysis-grid';
import type { CedarAnalysis } from '@/types';

/**
 * Mobile Safari (and some Android browsers) suspend JS execution when the tab
 * is backgrounded, the screen locks, or the user switches apps. This kills
 * in-flight ReadableStream reads, causing the SSE stream to end without the
 * final `result` event. The stall-detection timeout catches this case.
 */
const STREAM_STALL_TIMEOUT_MS = 90_000;

/**
 * Reads the cedar-detect SSE stream (progress + final compact samples/summary).
 * Includes stall detection for mobile browsers that suspend streams.
 */
export async function readCedarDetectSse(
  res: Response,
  onProgress?: (payload: Record<string, unknown>) => void
): Promise<CedarAnalysis> {
  if (!res.body) {
    throw new Error('Spectral analysis: no response body from server.');
  }
  const reader = res.body.getReader();

  const decoder = new TextDecoder();
  let buffer = '';
  let resultData: CedarAnalysis | null = null;
  let streamError: string | null = null;

  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let stalled = false;

  function resetStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      try { reader.cancel(); } catch { /* already closed */ }
    }, STREAM_STALL_TIMEOUT_MS);
  }

  resetStallTimer();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      resetStallTimer();

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
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }

  if (streamError) {
    throw new Error(streamError);
  }
  if (!resultData) {
    const reason = stalled ? 'stream_stall' : 'stream_ended';
    const err = new Error(
      stalled
        ? 'Spectral analysis stream stalled — your device may have suspended the connection. Retrying…'
        : 'No spectral result was received. The analysis stream may have been cut off.'
    );
    (err as Error & { reason: string }).reason = reason;
    throw err;
  }
  return resultData;
}

/** Max retries for a single chunk when the stream disconnects. */
const MAX_CHUNK_RETRIES = 3;

/** Fetch timeout per chunk: generous for a long-running SSE stream. */
const CHUNK_FETCH_TIMEOUT_MS = 310_000;

/**
 * Fetch + read a single cedar-detect chunk with automatic retry on stream
 * disconnection (mobile Safari backgrounding, cellular network glitches).
 */
export async function fetchCedarDetectChunkWithRetry(
  coords: number[][][],
  acreage: number,
  month: number,
  latitude: number,
  onProgress?: (payload: Record<string, unknown>) => void
): Promise<CedarAnalysis> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHUNK_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch('/api/cedar-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates: coords, acreage, month, latitude }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let msg = `Spectral analysis failed (${res.status})`;
        try {
          const errBody = (await res.json()) as { error?: string; detail?: string };
          if (errBody.error) msg = errBody.detail ? `${errBody.error}: ${errBody.detail}` : errBody.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }

      const result = await readCedarDetectSse(res, onProgress);
      return result;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      const isRetryable =
        lastError.name === 'AbortError' ||
        (lastError as Error & { reason?: string }).reason === 'stream_stall' ||
        (lastError as Error & { reason?: string }).reason === 'stream_ended' ||
        lastError.message.includes('network') ||
        lastError.message.includes('Failed to fetch') ||
        lastError.message.includes('Load failed') ||
        lastError.message.includes('The operation was aborted') ||
        lastError.message.includes('stream may have been cut off');

      if (!isRetryable || attempt >= MAX_CHUNK_RETRIES - 1) {
        throw lastError;
      }

      const delayMs = 2000 + attempt * 1500 + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, delayMs));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error('Spectral analysis failed after retries.');
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
