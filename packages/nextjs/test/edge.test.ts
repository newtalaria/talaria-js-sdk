import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addBreadcrumb, captureException, initEdge, setContext, setUser } from '../src/edge/index.ts';

describe('edge capture', () => {
  it('sends scope context, user, and breadcrumbs with the exception', async () => {
    let eventBody: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      eventBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      initEdge({
        dsn: 'http://127.0.0.1:9',
        apiKey: 'tal_live_test',
        release: 'edge-1',
      });
      setUser({ id: 'user-9' });
      setContext('checkout', { step: 'payment' });
      addBreadcrumb({ type: 'navigation', message: '/checkout' });
      await captureException(new Error('edge boom'));

      const events = (eventBody!.input as { events: Array<Record<string, unknown>> }).events;
      const event = events[0]!;
      assert.equal(event.userId, 'user-9');
      assert.equal(event.release, 'edge-1');
      assert.equal(event.message, 'edge boom');
      assert.deepEqual(JSON.parse(String(event.extraJson)), {
        checkout: { step: 'payment' },
      });
      const crumbs = event.breadcrumbs as Array<Record<string, unknown>>;
      assert.equal(crumbs.length, 1);
      assert.equal(crumbs[0]!.message, '/checkout');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
