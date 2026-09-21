import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AnalyticsFacade,
  IdentityStore,
  ServerpodTransport,
  createMemoryStorage,
  ingestAnalyticsEventBatch,
  serializeAnalyticsEvent,
} from '../src/index.ts';

describe('analytics ingest serialization', () => {
  it('posts IngestAnalyticsEventBatchInput', async () => {
    let url = '';
    let body: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      await ingestAnalyticsEventBatch(transport, [
        {
          name: 'product_viewed',
          kind: 'track',
          anonymousId: 'anon-1',
          sessionId: 'sess-1',
          timestamp: '2026-09-21T00:00:00.000Z',
          userId: 'user_123',
          replayId: 'replay-1',
          traceId: 'a'.repeat(32),
          spanId: 'b'.repeat(16),
          platform: 'javascript',
          environment: 'production',
          url: 'https://shop.example.com/p',
          path: '/p',
          title: 'Product',
          referrer: 'https://google.com/',
          utmSource: 'google',
          propertiesJson: JSON.stringify({ product_id: '123', price: 129.99 }),
        },
      ]);

      assert.equal(url, 'http://localhost:8080/analytics/ingestBatch');
      const input = body!.input as Record<string, unknown>;
      assert.equal(input.__className__, 'IngestAnalyticsEventBatchInput');
      const events = input.events as Array<Record<string, unknown>>;
      assert.equal(events.length, 1);
      assert.equal(events[0]!.__className__, 'IngestAnalyticsEventInput');
      assert.equal(events[0]!.name, 'product_viewed');
      assert.equal(events[0]!.kind, 'track');
      assert.equal(events[0]!.anonymousId, 'anon-1');
      assert.equal(events[0]!.sessionId, 'sess-1');
      assert.equal(events[0]!.userId, 'user_123');
      assert.equal(events[0]!.utmSource, 'google');
      assert.equal(
        events[0]!.propertiesJson,
        JSON.stringify({ product_id: '123', price: 129.99 }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('no-ops on an empty batch', async () => {
    let called = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      await ingestAnalyticsEventBatch(transport, []);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('omits empty optional fields', () => {
    const serialized = serializeAnalyticsEvent({
      name: '$pageview',
      kind: 'page',
      anonymousId: 'a',
      sessionId: 's',
      timestamp: '2026-09-21T00:00:00.000Z',
    });
    assert.equal(serialized.userId, undefined);
    assert.equal(serialized.propertiesJson, undefined);
    assert.equal(serialized.__className__, 'IngestAnalyticsEventInput');
  });
});

describe('AnalyticsFacade consent', () => {
  it('does not flush until optIn', async () => {
    let called = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      called += 1;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      const identity = new IdentityStore(createMemoryStorage(), {
        createId: () => 'id-1',
      });
      identity.touchSession();
      const analytics = new AnalyticsFacade({
        getTransport: () => transport,
        getIdentity: () => identity,
        getUserId: () => undefined,
        setUser: () => undefined,
        getReplayId: () => null,
        getTraceId: () => null,
        getSpanId: () => null,
        getPlatform: () => 'javascript',
        getEnvironment: () => 'development',
        getRelease: () => undefined,
        getPageContext: () => ({}),
        mapScreenToPage: true,
        logLabel: '@newtalaria/core',
        onPermanentError: () => undefined,
      });

      analytics.track('product_viewed', { product_id: '123' });
      await analytics.flush();
      assert.equal(called, 0);

      analytics.optIn();
      analytics.track('product_viewed', { product_id: '123', price: 129.99 });
      await analytics.flush();
      assert.equal(called, 1);

      analytics.optOut();
      analytics.track('ignored');
      await analytics.flush();
      assert.equal(called, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
