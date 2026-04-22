import { normalizeCedarAnalysisPayload } from '@/lib/cedar-analysis-grid';
import type { CedarAnalysis, CedarAnalysisSummary } from '@/types';
import { samplesToGridCells, type SpectralSamplePayload } from '@/lib/cedar-analysis-grid';

/**
 * Mobile Safari (and some Android browsers) suspend JS execution when the tab
 * is backgrounded, the screen locks, or the user switches apps. This kills
 * in-flight ReadableStream reads, causing the SSE stream to end without the
 * final `result` event. The stall-detection timeout catches this case.
 */
const STREAM_STALL_TIMEOUT_MS = 90_000;

/**
 * Reads the cedar-detect SSE stream.
 *
 * Supports two result protocols:
 * 1. Legacy: single `result` event with {summary, samples}
 * 2. Batched: `result_summary` → N × `result_samples` → `result_done`
 *    (avoids single-event size limits that cause silent drops on Vercel/mobile)
 */
export async function readCedarDetectSse(
  res: Response,
  onProgress?: (payload: Record<string, unknown>) => void,
  logTag?: string,
): Promise<CedarAnalysis> {
  const tag = logTag ?? 'sse';
  if (!res.body) {
    console.error(`[${tag}] no response body`);
    throw new Error('Spectral analysis: no response body from server.');
  }
  const reader = res.body.getReader();

  const decoder = new TextDecoder();
  let buffer = '';
  let resultData: CedarAnalysis | null = null;
  let streamError: string | null = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastEventType = '';

  let batchedSummary: CedarAnalysisSummary | null = null;
  const batchedSamples: SpectralSamplePayload[] = [];
  let batchCount = 0;

  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let stalled = false;

  function resetStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      console.warn(`[${tag}] stall detected after ${STREAM_STALL_TIMEOUT_MS}ms — cancelling reader (chunks=${chunkCount}, bytes=${totalBytes})`);
      try { reader.cancel(); } catch { /* already closed */ }
    }, STREAM_STALL_TIMEOUT_MS);
  }

  resetStallTimer();

  console.log(`[${tag}] starting SSE read`);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log(`[${tag}] reader done: chunks=${chunkCount}, bytes=${totalBytes}, hasResult=${!!resultData}, batchedSamples=${batchedSamples.length}, hasError=${!!streamError}`);
        break;
      }

      chunkCount++;
      totalBytes += value.byteLength;
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
            lastEventType = eventType;
            if (eventType === 'progress') {
              onProgress?.(payload);
            } else if (eventType === 'error') {
              streamError =
                typeof payload.message === 'string'
                  ? payload.message
                  : 'Spectral analysis failed on the server.';
              console.error(`[${tag}] server error event: ${streamError}`);
            } else if (eventType === 'result') {
              console.log(`[${tag}] legacy result event: samples=${Array.isArray(payload.samples) ? (payload.samples as unknown[]).length : 'n/a'}, hasSummary=${!!payload.summary}`);
              resultData = normalizeCedarAnalysisPayload(payload);
              if (!resultData) {
                console.error(`[${tag}] normalizeCedarAnalysisPayload returned null! keys: ${Object.keys(payload).join(', ')}`);
              }
            } else if (eventType === 'result_summary') {
              batchedSummary = payload.summary as CedarAnalysisSummary;
              console.log(`[${tag}] result_summary: totalBatches=${payload.totalBatches}, totalSamples=${batchedSummary?.totalSamples}`);
            } else if (eventType === 'result_samples') {
              const batch = payload.samples as SpectralSamplePayload[];
              if (Array.isArray(batch)) {
                batchedSamples.push(...batch);
                batchCount++;
              }
            } else if (eventType === 'result_done') {
              console.log(`[${tag}] result_done: batchCount=${batchCount}, totalSamples=${batchedSamples.length}, expected=${payload.totalSamples}`);
              if (batchedSummary && batchedSamples.length > 0) {
                let halfLng = batchedSummary.cellHalfLngDeg;
                let halfLat = batchedSummary.cellHalfLatDeg;
                if (halfLng == null || halfLat == null) {
                  const m = batchedSummary.gridSpacingM / 2;
                  halfLat = m / 111_320;
                  halfLng = m / 111_320;
                }
                const gridCells = samplesToGridCells(batchedSamples, halfLng, halfLat);
                resultData = { summary: batchedSummary, gridCells };
                console.log(`[${tag}] assembled batched result: ${batchedSamples.length} samples, ${gridCells.features.length} grid cells`);
              } else {
                console.error(`[${tag}] result_done but missing data: summary=${!!batchedSummary}, samples=${batchedSamples.length}`);
              }
            }
          } catch (parseErr) {
            console.warn(`[${tag}] SSE parse error for event '${eventType}': ${parseErr instanceof Error ? parseErr.message : parseErr}, lineLen=${line.length}`);
          }
          eventType = '';
        }
      }
    }
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }

  if (streamError) {
    console.error(`[${tag}] throwing server error: ${streamError}`);
    throw new Error(streamError);
  }

  if (!resultData) {
    const fallbackText = buffer.trim();
    if (fallbackText.startsWith('{')) {
      try {
        const payload = JSON.parse(fallbackText) as Record<string, unknown>;
        resultData = normalizeCedarAnalysisPayload(payload);
        if (resultData) {
          console.log(`[${tag}] parsed non-SSE JSON fallback: ${resultData.summary?.totalSamples ?? '?'} samples`);
        }
      } catch (parseErr) {
        console.warn(`[${tag}] JSON fallback parse failed: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
      }
    }
  }

  if (!resultData) {
    const reason = stalled ? 'stream_stall' : 'stream_ended';
    console.error(`[${tag}] no result: reason=${reason}, lastEvent=${lastEventType}, chunks=${chunkCount}, bytes=${totalBytes}, bufferLen=${buffer.length}, batchedSamples=${batchedSamples.length}`);
    const err = new Error(
      stalled
        ? 'Spectral analysis stream stalled — your device may have suspended the connection. Retrying…'
        : 'No spectral result was received. The analysis stream may have been cut off.'
    );
    (err as Error & { reason: string }).reason = reason;
    throw err;
  }
  console.log(`[${tag}] success: ${resultData.summary?.totalSamples ?? '?'} samples`);
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
  const tag = `chunk-${Math.random().toString(36).slice(2, 6)}`;

  for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
    const attemptTag = `${tag}-a${attempt}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      console.warn(`[${attemptTag}] fetch timeout after ${CHUNK_FETCH_TIMEOUT_MS}ms — aborting`);
      controller.abort();
    }, CHUNK_FETCH_TIMEOUT_MS);

    try {
      console.log(`[${attemptTag}] fetching cedar-detect: ${acreage.toFixed(1)} ac, lat=${latitude.toFixed(4)}`);
      const res = await fetch('/api/cedar-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates: coords, acreage, month, latitude }),
        signal: controller.signal,
      });

      console.log(`[${attemptTag}] response: status=${res.status}, ok=${res.ok}, type=${res.headers.get('content-type')}`);

      if (!res.ok) {
        let msg = `Spectral analysis failed (${res.status})`;
        try {
          const errBody = (await res.json()) as { error?: string; detail?: string };
          if (errBody.error) msg = errBody.detail ? `${errBody.error}: ${errBody.detail}` : errBody.error;
        } catch { /* ignore */ }
        console.error(`[${attemptTag}] non-ok response: ${msg}`);
        throw new Error(msg);
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const payload = (await res.json()) as Record<string, unknown>;
        const normalized = normalizeCedarAnalysisPayload(payload);
        if (!normalized) {
          throw new Error('Spectral analysis returned JSON, but the payload was not a valid cedar analysis result.');
        }
        console.log(`[${attemptTag}] parsed JSON cedar result: samples=${normalized.summary?.totalSamples ?? '?'} `);
        return normalized;
      }

      const result = await readCedarDetectSse(res, onProgress, attemptTag);
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

      console.error(`[${attemptTag}] error: name=${lastError.name}, reason=${(lastError as Error & { reason?: string }).reason ?? '-'}, msg=${lastError.message}, retryable=${isRetryable}, attemptsLeft=${MAX_CHUNK_RETRIES - 1 - attempt}`);

      if (!isRetryable || attempt >= MAX_CHUNK_RETRIES - 1) {
        throw lastError;
      }

      const delayMs = 2000 + attempt * 1500 + Math.random() * 1000;
      console.log(`[${attemptTag}] retrying in ${Math.round(delayMs)}ms...`);
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
