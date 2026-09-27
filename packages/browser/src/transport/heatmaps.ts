import type { ServerpodTransport } from './serverpod.js';
import { toServerpodByteData } from '../utils/gzip.js';

/** Server rejects more than 50 pageviews or 1000 clicks in one batch. */
export const MAX_HEATMAP_PAGEVIEWS_PER_BATCH = 50;
export const MAX_HEATMAP_CLICKS_PER_BATCH = 1_000;
/** `fetch(keepalive)` bodies are capped at 64 KiB across in-flight requests. */
export const MAX_KEEPALIVE_BODY_BYTES = 56 * 1024;
/** Server rejects heatmap snapshots larger than this (gzip). */
export const MAX_HEATMAP_SNAPSHOT_BYTES = 3 * 1024 * 1024;

export interface HeatmapClickParams {
  clickIndex: number;
  occurredAt: string;
  selector: string;
  tag: string;
  relX: number;
  relY: number;
  pageX: number;
  pageY: number;
  rage: boolean;
  dead: boolean;
  error: boolean;
}

export interface HeatmapPageViewParams {
  pageViewId: string;
  anonymousId: string;
  sessionId: string;
  userId?: string;
  replayId?: string;
  url: string;
  path?: string;
  startedAt: string;
  updatedAt: string;
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
  maxScrollDepthPx: number;
  initialFoldPx: number;
  environment?: string;
  release?: string;
  browserName?: string;
  browserVersion?: string;
  osName?: string;
  device?: string;
  bot?: boolean;
  botKind?: string;
  webdriver?: boolean;
  clicks: HeatmapClickParams[];
}

export interface HeatmapBatchResult {
  acceptedPageViews: number;
  acceptedClicks: number;
  enabled: boolean;
  snapshotRequests: string[];
}

function serializeClick(c: HeatmapClickParams): Record<string, unknown> {
  return {
    __className__: 'IngestHeatmapClickInput',
    clickIndex: c.clickIndex,
    occurredAt: c.occurredAt,
    selector: c.selector,
    tag: c.tag,
    relX: c.relX,
    relY: c.relY,
    pageX: c.pageX,
    pageY: c.pageY,
    rage: c.rage,
    dead: c.dead,
    error: c.error,
  };
}

export function serializeHeatmapPageView(
  p: HeatmapPageViewParams,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    __className__: 'IngestHeatmapPageViewInput',
    pageViewId: p.pageViewId,
    anonymousId: p.anonymousId,
    sessionId: p.sessionId,
    url: p.url,
    startedAt: p.startedAt,
    updatedAt: p.updatedAt,
    viewportWidth: p.viewportWidth,
    viewportHeight: p.viewportHeight,
    documentWidth: p.documentWidth,
    documentHeight: p.documentHeight,
    maxScrollDepthPx: p.maxScrollDepthPx,
    initialFoldPx: p.initialFoldPx,
    clicks: p.clicks.map(serializeClick),
  };
  if (p.userId) out.userId = p.userId;
  if (p.replayId) out.replayId = p.replayId;
  if (p.path) out.path = p.path;
  if (p.environment) out.environment = p.environment;
  if (p.release) out.release = p.release;
  if (p.browserName) out.browserName = p.browserName;
  if (p.browserVersion) out.browserVersion = p.browserVersion;
  if (p.osName) out.osName = p.osName;
  if (p.device) out.device = p.device;
  if (p.bot === true) out.bot = true;
  if (p.botKind) out.botKind = p.botKind;
  if (p.webdriver === true) out.webdriver = true;
  return out;
}

/**
 * Split pageviews into batches the server accepts. A pageview with more
 * clicks than fit is repeated across batches with a slice of its clicks —
 * the server upserts the pageview row and appends clicks.
 */
export function chunkHeatmapPageViews(
  pageViews: HeatmapPageViewParams[],
  opts?: { maxBytes?: number },
): HeatmapPageViewParams[][] {
  const maxBytes = opts?.maxBytes ?? Number.POSITIVE_INFINITY;
  const batches: HeatmapPageViewParams[][] = [];
  let current: HeatmapPageViewParams[] = [];
  let clicks = 0;
  let bytes = 0;

  const pushCurrent = () => {
    if (current.length > 0) batches.push(current);
    current = [];
    clicks = 0;
    bytes = 0;
  };

  for (const pv of pageViews) {
    const base = { ...pv, clicks: [] as HeatmapClickParams[] };
    const baseBytes = JSON.stringify(serializeHeatmapPageView(base)).length;
    let remaining = pv.clicks;
    let first = true;
    while (first || remaining.length > 0) {
      first = false;
      if (
        current.length >= MAX_HEATMAP_PAGEVIEWS_PER_BATCH ||
        bytes + baseBytes > maxBytes
      ) {
        pushCurrent();
      }
      const slice: HeatmapClickParams[] = [];
      let sliceBytes = baseBytes;
      while (remaining.length > 0 && clicks < MAX_HEATMAP_CLICKS_PER_BATCH) {
        const next = remaining[0]!;
        const nextBytes = JSON.stringify(serializeClick(next)).length + 1;
        if (bytes + sliceBytes + nextBytes > maxBytes && slice.length > 0) break;
        if (bytes + sliceBytes + nextBytes > maxBytes && current.length > 0) break;
        slice.push(next);
        sliceBytes += nextBytes;
        clicks += 1;
        remaining = remaining.slice(1);
      }
      current.push({ ...base, clicks: slice });
      bytes += sliceBytes;
      if (remaining.length > 0) pushCurrent();
    }
  }
  pushCurrent();
  return batches;
}

export function parseHeatmapBatchResponse(raw: unknown): HeatmapBatchResult {
  const map =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const nested =
    map.data && typeof map.data === 'object'
      ? (map.data as Record<string, unknown>)
      : map;
  const requests = Array.isArray(nested.snapshotRequests)
    ? nested.snapshotRequests.filter((v): v is string => typeof v === 'string')
    : [];
  return {
    acceptedPageViews: Number(nested.acceptedPageViews) || 0,
    acceptedClicks: Number(nested.acceptedClicks) || 0,
    enabled: nested.enabled !== false,
    snapshotRequests: requests,
  };
}

/**
 * `POST {baseUrl}/heatmaps/ingestBatch`. Parallel to analytics — uses the
 * `analyticsWrite` key scope and follows analytics consent.
 */
export async function ingestHeatmapBatch(
  transport: ServerpodTransport,
  pageViews: HeatmapPageViewParams[],
  opts?: { keepalive?: boolean },
): Promise<HeatmapBatchResult> {
  const raw = await transport.call(
    'heatmaps',
    'ingestBatch',
    {
      input: {
        __className__: 'IngestHeatmapBatchInput',
        pageViews: pageViews.map(serializeHeatmapPageView),
      },
    },
    { keepalive: opts?.keepalive },
  );
  return parseHeatmapBatchResponse(raw);
}

export interface HeatmapSnapshotParams {
  pageViewId: string;
  gzip: Uint8Array;
  viewportWidth: number;
  viewportHeight: number;
  documentHeight: number;
  capturedAt: string;
}

/** `POST {baseUrl}/heatmaps/uploadSnapshot` — only for a server-requested pageview. */
export async function uploadHeatmapSnapshot(
  transport: ServerpodTransport,
  params: HeatmapSnapshotParams,
): Promise<unknown> {
  if (params.gzip.length > MAX_HEATMAP_SNAPSHOT_BYTES) {
    throw new Error(
      `Talaria heatmaps/uploadSnapshot skipped: snapshot exceeds ${MAX_HEATMAP_SNAPSHOT_BYTES} bytes`,
    );
  }
  return transport.call('heatmaps', 'uploadSnapshot', {
    input: {
      __className__: 'UploadHeatmapSnapshotInput',
      pageViewId: params.pageViewId,
      gzipBytes: toServerpodByteData(params.gzip),
      viewportWidth: params.viewportWidth,
      viewportHeight: params.viewportHeight,
      documentHeight: params.documentHeight,
      capturedAt: params.capturedAt,
    },
  });
}
