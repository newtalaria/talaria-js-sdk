import type { SdkConfigDocument } from '@newtalaria/core';

const accepting = { state: 'accepting' as const };

export function policyDocument(
  patch: Partial<SdkConfigDocument> = {},
): SdkConfigDocument {
  return {
    schemaVersion: 1,
    revision: 'test',
    active: true,
    ttlSeconds: 300,
    events: { sampleRate: null },
    tracing: { enabled: true, tracesSampleRate: 1 },
    analytics: { enabled: false },
    heatmaps: { enabled: false },
    replay: {
      enabled: false,
      sessionSampleRate: 0,
      errorSampleRate: 0,
      maxDurationMs: 300000,
      maskAllInputs: true,
      blockSelectors: [],
    },
    ingest: {
      events: accepting,
      transactions: accepting,
      replays: accepting,
      analytics: accepting,
    },
    ...patch,
  };
}
