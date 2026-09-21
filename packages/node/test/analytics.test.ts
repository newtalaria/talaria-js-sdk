import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TalariaNodeClient } from '../src/client.ts';

describe('TalariaNodeClient analytics', () => {
  it('does not send analytics until enableAnalytics / optIn', async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new TalariaNodeClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        disableDefaultIntegrations: true,
      });
      client.analytics.track('server_event');
      await client.analytics.flush();
      assert.equal(urls.some((u) => u.includes('/analytics/')), false);

      client.analytics.optIn();
      client.analytics.track('server_event', { ok: true }, { userId: 'u-1' });
      await client.analytics.flush();
      assert.equal(urls.some((u) => u.includes('/analytics/ingestBatch')), true);
      await client.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('stamps in-memory anonymousId on errors and track payload', async () => {
    let analyticsBody: Record<string, unknown> | null = null;
    let eventBody: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (url.includes('/analytics/')) analyticsBody = body;
      if (url.includes('/events/')) eventBody = body;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new TalariaNodeClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        disableDefaultIntegrations: true,
        enableAnalytics: true,
        anonymousId: 'node-anon',
      });
      await client.captureException(new Error('node boom'));
      client.analytics.identify('user_123', { plan: 'team' });
      await client.flush();

      const events = (eventBody!.input as { events: Array<Record<string, unknown>> })
        .events;
      assert.equal(events[0]!.anonymousId, 'node-anon');

      const aEvents = (
        analyticsBody!.input as { events: Array<Record<string, unknown>> }
      ).events;
      const identify = aEvents.find((e) => e.kind === 'identify');
      assert.ok(identify);
      assert.equal(identify.name, '$identify');
      assert.equal(identify.anonymousId, 'node-anon');
      assert.equal(identify.userId, 'user_123');
      assert.equal(identify.propertiesJson, JSON.stringify({ plan: 'team' }));
      await client.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
