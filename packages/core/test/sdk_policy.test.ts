import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IngestError } from '../src/transport/ingest_error.js';
import {
  clampTtlSeconds,
  disabledSignal,
  documentIsFresh,
  parseSdkConfig,
  tombstoneFromError,
  tombstoneIsQuiet,
  type SdkPolicyCacheEntry,
} from '../src/policy/sdk_policy.js';

const canonical = {
  schemaVersion: 1,
  revision: '11e725c5c2a05881',
  active: true,
  ttlSeconds: 300,
  events: { sampleRate: null },
  tracing: { enabled: true, tracesSampleRate: 0.1 },
  analytics: { enabled: true },
  heatmaps: { enabled: true },
  flags: { enabled: false },
  replay: {
    enabled: true,
    sessionSampleRate: 0.1,
    errorSampleRate: 1,
    maxDurationMs: 300000,
    maskAllInputs: true,
    blockSelectors: [],
  },
  ingest: {
    events: { state: 'accepting' },
    transactions: { state: 'accepting' },
    replays: { state: 'accepting' },
    analytics: { state: 'accepting' },
  },
};

describe('sdk policy document', () => {
  it('accepts schema 1 and rejects a newer shape', () => {
    assert.equal(parseSdkConfig(canonical)?.revision, '11e725c5c2a05881');
    assert.equal(parseSdkConfig({ ...canonical, schemaVersion: 2 }), null);
  });

  it('treats a fresh cache as usable without a network call', () => {
    const now = 1_000_000;
    const entry: SdkPolicyCacheEntry = {
      kind: 'document',
      fetchedAt: now - 10_000,
      document: canonical,
    };
    assert.equal(documentIsFresh(entry, now), true);
    assert.equal(
      documentIsFresh({ ...entry, fetchedAt: now - clampTtlSeconds(300) * 1000 - 1 }, now),
      false,
    );
  });

  it('tombstones a rejected key and not a disabled signal', () => {
    const now = 50;
    const tombstone = tombstoneFromError(
      new IngestError({ className: 'ApiNotFoundException', message: 'Project not found', retry: false }),
      now,
    );
    assert.equal(tombstone?.kind, 'tombstone');
    assert.equal(tombstoneIsQuiet(tombstone!, now + 1000), true);
    assert.equal(
      tombstoneFromError(
        new IngestError({
          className: 'ApiConflictException',
          message: 'Tracing is disabled for this project',
          retry: false,
        }),
        now,
      ),
      null,
    );
    assert.equal(
      disabledSignal(
        new IngestError({
          className: 'ApiConflictException',
          message: 'Analytics is disabled for this project',
          retry: false,
        }),
      ),
      'analytics',
    );
  });
});
