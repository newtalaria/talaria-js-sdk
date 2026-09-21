import type { ServerpodTransport } from './serverpod.js';

export type AnalyticsEventKind = 'track' | 'page' | 'screen' | 'identify';

export const ANALYTICS_DEFAULT_NAMES: Record<AnalyticsEventKind, string> = {
  track: '',
  page: '$pageview',
  screen: '$screen',
  identify: '$identify',
};

/** Server rejects more than 200 analytics events in one batch. */
export const MAX_ANALYTICS_BATCH = 200;

export interface IngestAnalyticsEventParams {
  eventId?: string;
  name: string;
  kind: AnalyticsEventKind;
  anonymousId: string;
  sessionId: string;
  timestamp: string;
  userId?: string;
  replayId?: string;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  platform?: string;
  environment?: string;
  release?: string;
  url?: string;
  path?: string;
  title?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  propertiesJson?: string;
}

export function serializeAnalyticsEvent(
  params: IngestAnalyticsEventParams,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    __className__: 'IngestAnalyticsEventInput',
    name: params.name,
    kind: params.kind,
    anonymousId: params.anonymousId,
    sessionId: params.sessionId,
    timestamp: params.timestamp,
  };
  if (params.eventId) out.eventId = params.eventId;
  if (params.userId) out.userId = params.userId;
  if (params.replayId) out.replayId = params.replayId;
  if (params.traceId) out.traceId = params.traceId;
  if (params.spanId) out.spanId = params.spanId;
  if (params.requestId) out.requestId = params.requestId;
  if (params.platform) out.platform = params.platform;
  if (params.environment) out.environment = params.environment;
  if (params.release) out.release = params.release;
  if (params.url) out.url = params.url;
  if (params.path) out.path = params.path;
  if (params.title) out.title = params.title;
  if (params.referrer) out.referrer = params.referrer;
  if (params.utmSource) out.utmSource = params.utmSource;
  if (params.utmMedium) out.utmMedium = params.utmMedium;
  if (params.utmCampaign) out.utmCampaign = params.utmCampaign;
  if (params.utmTerm) out.utmTerm = params.utmTerm;
  if (params.utmContent) out.utmContent = params.utmContent;
  if (params.propertiesJson) out.propertiesJson = params.propertiesJson;
  return out;
}

/**
 * Batch-ingest product analytics. Parallel path — never mix with events/spans.
 *
 * `POST {baseUrl}/analytics/ingestBatch` with
 * `__className__: 'IngestAnalyticsEventBatchInput'`.
 */
export async function ingestAnalyticsEventBatch(
  transport: ServerpodTransport,
  events: IngestAnalyticsEventParams[],
  opts?: { keepalive?: boolean },
): Promise<unknown> {
  if (events.length === 0) return undefined;
  return transport.call(
    'analytics',
    'ingestBatch',
    {
      input: {
        __className__: 'IngestAnalyticsEventBatchInput',
        events: events.map(serializeAnalyticsEvent),
      },
    },
    { keepalive: opts?.keepalive },
  );
}
