import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TalariaNodeClient } from '../src/client.ts';

describe('TalariaNodeClient', () => {
  it('sends captureException via events/ingestBatch', async () => {
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
      const client = new TalariaNodeClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        disableDefaultIntegrations: true,
      });
      client.setUser({ id: 'n-1' });
      await client.captureException(new Error('node boom'));
      await client.close();

      assert.match(url, /\/events\/ingestBatch$/);
      const input = body!.input as Record<string, unknown>;
      const events = input.events as Array<Record<string, unknown>>;
      assert.equal(events[0]!.platform, 'node');
      assert.equal(events[0]!.userId, 'n-1');
      assert.equal(events[0]!.message, 'node boom');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
