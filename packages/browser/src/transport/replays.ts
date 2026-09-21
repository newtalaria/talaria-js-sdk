import type { ServerpodTransport } from './serverpod.js';
import { gzipBytes, toServerpodByteData } from '../utils/gzip.js';
import { MAX_COMPRESSED_SEGMENT_BYTES } from '../replay/segment_buffer.js';

export interface StartReplayParams {
  replayId: string;
  environment: string;
  sessionId?: string;
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
    environment: params.environment,
  };
  if (params.sessionId) input.sessionId = params.sessionId;
  if (params.url) input.url = params.url;
  if (params.userId) input.userId = params.userId;
  if (params.userAgent) input.userAgent = params.userAgent;

  return transport.call(
    'replays',
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

export async function ingestReplaySegment(
  transport: ServerpodTransport,
  params: IngestSegmentParams,
): Promise<unknown> {
  const compressed =
    params.gzip ?? (await compressReplayEvents(params.events));
  ensureSegmentFits(compressed, 'ingestSegment');

  return transport.call(
    'replays',
    'ingestSegment',
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

  const serialized = [];
  for (const params of segments) {
    const compressed =
      params.gzip ?? (await compressReplayEvents(params.events));
    ensureSegmentFits(compressed, 'ingestSegmentBatch');
    serialized.push(serializeSegmentInput(params, compressed));
  }

  const raw = await transport.call(
    'replays',
    'ingestSegmentBatch',
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
    'replays',
    'finish',
    { input },
    { keepalive: params.keepalive },
  );
}
