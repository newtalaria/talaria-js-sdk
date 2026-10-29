import { TransportError } from '@newtalaria/core';
import type { ServerpodTransport } from './serverpod.js';
import { gzipBytes, toServerpodByteData } from '../utils/gzip.js';
import { MAX_COMPRESSED_SEGMENT_BYTES } from '../replay/segment_buffer.js';

export interface StartReplayParams {
  replayId: string;
  sessionId?: string;
  anonymousId?: string;
  url?: string;
  userId?: string;
  userAgent?: string;
  keepalive?: boolean;
}

export interface IngestSegmentParams {
  replayId: string;
  segmentIndex: number;
  events: unknown[];
  startedAt: Date;
  endedAt: Date;
  keepalive?: boolean;
  /** Precomputed gzip payload; when set, `events` is only used for eventCount. */
  gzip?: Uint8Array;
}

export interface FinishReplayParams {
  replayId: string;
  reason?: string;
  keepalive?: boolean;
}

export async function compressReplayEvents(
  events: unknown[],
): Promise<Uint8Array> {
  const json = JSON.stringify(events);
  return gzipBytes(new TextEncoder().encode(json));
}

export async function startReplay(
  transport: ServerpodTransport,
  params: StartReplayParams,
): Promise<unknown> {
  const input: Record<string, unknown> = {
    __className__: 'StartReplayInput',
    replayId: params.replayId,
  };
  if (params.sessionId) input.sessionId = params.sessionId;
  if (params.anonymousId) input.anonymousId = params.anonymousId;
  if (params.url) input.url = params.url;
  if (params.userId) input.userId = params.userId;
  if (params.userAgent) input.userAgent = params.userAgent;

  return transport.call(
    'v1/replays',
    'start',
    { input },
    { keepalive: params.keepalive },
  );
}

export interface IngestSegmentBatchResult {
  replayId: string;
  acceptedCount: number;
  failedCount: number;
  failures: Array<{ index: number; message: string }>;
}

function serializeSegmentInput(params: IngestSegmentParams, gzip: Uint8Array) {
  return {
    __className__: 'IngestReplaySegmentInput',
    replayId: params.replayId,
    segmentIndex: params.segmentIndex,
    gzipBytes: toServerpodByteData(gzip),
    eventCount: params.events.length,
    startedAt: params.startedAt.toISOString(),
    endedAt: params.endedAt.toISOString(),
  };
}

function ensureSegmentFits(compressed: Uint8Array, method: string): void {
  if (compressed.length > MAX_COMPRESSED_SEGMENT_BYTES) {
    throw new Error(
      `Talaria replays/${method} failed: HTTP 400 — segment exceeds max compressed size (${compressed.length} > ${MAX_COMPRESSED_SEGMENT_BYTES})`,
    );
  }
}

export const REPLAY_SEGMENTS_PATH = '/v1/replays/segments';

/**
 * Binary route statuses that mean "this server (or its proxy) doesn't have
 * the route": switch to base64 RPC for good and resend there.
 */
export function isMissingBinaryRoute(error: unknown): boolean {
  return (
    error instanceof TransportError &&
    (error.status === 404 || error.status === 405 || error.status === 415)
  );
}

/** Raw gzip segment to the binary route (no base64). */
async function postSegmentBinary(
  transport: ServerpodTransport,
  params: IngestSegmentParams,
  compressed: Uint8Array,
): Promise<unknown> {
  return transport.callBinary(
    REPLAY_SEGMENTS_PATH,
    {
      replayId: params.replayId,
      segmentIndex: params.segmentIndex,
      eventCount: params.events.length,
      startedAt: params.startedAt.toISOString(),
      endedAt: params.endedAt.toISOString(),
    },
    compressed,
  );
}

/** Binary route when advertised and not a page-close send. */
function useBinary(transport: ServerpodTransport, keepalive?: boolean) {
  return transport.capabilities.binaryUploads && !keepalive;
}

export async function ingestReplaySegment(
  transport: ServerpodTransport,
  params: IngestSegmentParams,
): Promise<unknown> {
  const compressed =
    params.gzip ?? (await compressReplayEvents(params.events));
  ensureSegmentFits(compressed, 'ingestSegment');

  if (useBinary(transport, params.keepalive)) {
    try {
      return await postSegmentBinary(transport, params, compressed);
    } catch (error) {
      if (!isMissingBinaryRoute(error)) throw error;
      transport.disableBinaryUploads();
    }
  }

  return transport.call(
    'v1/replays',
    'segments',
    { input: serializeSegmentInput(params, compressed) },
    { keepalive: params.keepalive },
  );
}

/**
 * Upload several gzip segments in one RPC. A 200 with `failedCount > 0`
 * means the prefix landed and the client should retry from `failures[0].index`.
 */
export async function ingestReplaySegmentBatch(
  transport: ServerpodTransport,
  segments: IngestSegmentParams[],
  opts?: { keepalive?: boolean },
): Promise<IngestSegmentBatchResult> {
  if (segments.length === 0) {
    throw new Error('Talaria replays/ingestSegmentBatch requires segments');
  }

  const compressedAll: Uint8Array[] = [];
  for (const params of segments) {
    const compressed =
      params.gzip ?? (await compressReplayEvents(params.events));
    ensureSegmentFits(compressed, 'ingestSegmentBatch');
    compressedAll.push(compressed);
  }

  if (useBinary(transport, opts?.keepalive)) {
    // One binary POST per segment, in order. Same contract as the batch
    // RPC: the prefix that landed counts, the first failure is reported
    // and the caller retries from there.
    let accepted = 0;
    let replayId = segments[0]!.replayId;
    for (let i = 0; i < segments.length; i++) {
      try {
        const raw = await postSegmentBinary(
          transport,
          segments[i]!,
          compressedAll[i]!,
        );
        const map =
          raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        if (typeof map.replayId === 'string' && map.replayId) {
          replayId = map.replayId;
        }
        accepted++;
      } catch (error) {
        if (isMissingBinaryRoute(error) && i === 0) {
          transport.disableBinaryUploads();
          break;
        }
        if (i === 0) throw error;
        return {
          replayId,
          acceptedCount: accepted,
          failedCount: segments.length - accepted,
          failures: [
            {
              index: i,
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    }
    if (accepted === segments.length) {
      return { replayId, acceptedCount: accepted, failedCount: 0, failures: [] };
    }
  }

  const serialized = segments.map((params, i) =>
    serializeSegmentInput(params, compressedAll[i]!),
  );

  const raw = await transport.call(
    'v1/replays',
    'segments',
    {
      input: {
        __className__: 'IngestReplaySegmentBatchInput',
        segments: serialized,
      },
    },
    { keepalive: opts?.keepalive },
  );

  return parseSegmentBatchResponse(raw, segments[0]!.replayId);
}

export function parseSegmentBatchResponse(
  raw: unknown,
  fallbackReplayId: string,
): IngestSegmentBatchResult {
  const map =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const nested =
    map.data && typeof map.data === 'object'
      ? (map.data as Record<string, unknown>)
      : map;

  const failuresRaw = Array.isArray(nested.failures) ? nested.failures : [];
  const failures: Array<{ index: number; message: string }> = [];
  for (const item of failuresRaw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const index = typeof row.index === 'number' ? row.index : Number(row.index);
    const message = typeof row.message === 'string' ? row.message : '';
    if (Number.isInteger(index) && index >= 0) {
      failures.push({ index, message });
    }
  }

  const acceptedCount =
    typeof nested.acceptedCount === 'number'
      ? nested.acceptedCount
      : Number(nested.acceptedCount) || 0;
  const failedCount =
    typeof nested.failedCount === 'number'
      ? nested.failedCount
      : failures.length;
  const replayId =
    typeof nested.replayId === 'string' && nested.replayId
      ? nested.replayId
      : fallbackReplayId;

  return { replayId, acceptedCount, failedCount, failures };
}

export async function finishReplay(
  transport: ServerpodTransport,
  params: FinishReplayParams,
): Promise<unknown> {
  const input: Record<string, unknown> = {
    __className__: 'FinishReplayInput',
    replayId: params.replayId,
  };
  if (params.reason) input.reason = params.reason;

  return transport.call(
    'v1/replays',
    'finish',
    { input },
    { keepalive: params.keepalive },
  );
}
