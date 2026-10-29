import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TalariaClient } from '../src/client.ts';

function eventInput(body: Record<string, unknown> | null): Record<string, unknown> {
  const events = body?.events as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(events)) return events[0]!;
  return body ?? {};
}

describe('runtime scope APIs', () => {
  it('setUser and addBreadcrumb attach to the next event', async () => {
    let body: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new TalariaClient();
      client.init({
        url: 'http://localhost:8080',
        apiKey: 'tal_pk_test_nz1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1zu896',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });
      client.setUser({ id: 'user-42' });
      client.addBreadcrumb({
        type: 'user',
        category: 'auth',
        message: 'signed in',
      });
      await client.captureException(new Error('after sign-in'));
      await client.flush();
      await client.close();

      const input = eventInput(body);
      assert.equal(input.userId, 'user-42');
      const crumbs = input.breadcrumbs as Array<Record<string, unknown>>;
      assert.ok(crumbs.some((c) => c.message === 'signed in'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
