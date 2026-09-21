import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TalariaClient } from '../src/client.ts';

function installMemoryLocalStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
  return map;
}

describe('browser analytics + identity', () => {
  it('does not flush analytics until optIn, but stamps anonymousId on errors', async () => {
    installMemoryLocalStorage();
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });

      client.analytics.track('product_viewed', { product_id: '123' });
      await client.analytics.flush();
      assert.equal(
        posts.some((p) => p.url.includes('/analytics/')),
        false,
      );

      await client.captureException(new Error('boom'));
      const eventPost = posts.find((p) => p.url.includes('/events/ingestBatch'));
      assert.ok(eventPost);
      const input = eventPost.body.input as Record<string, unknown>;
      const events = input.events as Array<Record<string, unknown>>;
      assert.equal(typeof events[0]!.anonymousId, 'string');
      assert.ok(String(events[0]!.anonymousId).length > 0);
      assert.equal(typeof events[0]!.sessionId, 'string');

      client.analytics.optIn();
      client.analytics.track('product_viewed', {
        product_id: '123',
        price: 129.99,
      });
      await client.analytics.flush();
      const analyticsPost = posts.find((p) =>
        p.url.includes('/analytics/ingestBatch'),
      );
      assert.ok(analyticsPost);
      const aInput = analyticsPost.body.input as Record<string, unknown>;
      assert.equal(aInput.__className__, 'IngestAnalyticsEventBatchInput');
      const aEvents = aInput.events as Array<Record<string, unknown>>;
      const track = aEvents.find((e) => e.name === 'product_viewed');
      assert.ok(track);
      assert.equal(track.kind, 'track');
      assert.equal(track.anonymousId, events[0]!.anonymousId);
      assert.equal(
        track.propertiesJson,
        JSON.stringify({ product_id: '123', price: 129.99 }),
      );

      await client.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('persists anonymousId across init and rotates session on reset', async () => {
    const map = installMemoryLocalStorage();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      const first = new TalariaClient();
      first.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });
      const anon1 = first.getAnonymousId();
      assert.ok(anon1);
      assert.equal(map.get('talaria.anonymousId'), anon1);
      await first.close();

      const second = new TalariaClient();
      second.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });
      assert.equal(second.getAnonymousId(), anon1);
      second.setUser({ id: 'user_123' });
      second.analytics.reset();
      assert.notEqual(second.getAnonymousId(), anon1);
      assert.equal(second.getUserId(), undefined);
      await second.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('auto-captures one $pageview per pathname when analytics is enabled', async () => {
    installMemoryLocalStorage();
    const names: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics/ingestBatch')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          input?: { events?: Array<{ name?: string; kind?: string }> };
        };
        for (const event of body.input?.events ?? []) {
          names.push(`${event.kind}:${event.name}`);
        }
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        enableAnalytics: true,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });
      await client.analytics.flush();
      assert.ok(names.includes('page:$pageview'));
      const countAfterInit = names.filter((n) => n === 'page:$pageview').length;

      client.startNavigation({ name: '/', url: 'http://localhost/' });
      await client.analytics.flush();
      assert.equal(
        names.filter((n) => n === 'page:$pageview').length,
        countAfterInit,
      );

      client.startNavigation({
        name: '/pricing',
        url: 'http://localhost/pricing',
      });
      await client.analytics.flush();
      assert.equal(
        names.filter((n) => n === 'page:$pageview').length,
        countAfterInit + 1,
      );
      await client.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
