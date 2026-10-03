import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { TalariaNodeClient } from '../src/client.ts';
import { installOutgoingHttpInstrumentation } from '../src/outgoing.ts';

describe('node scope context', () => {
  it('stamps setContext and setExtra onto the event', async () => {
    let eventBody: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (String(_input).includes('/events/')) eventBody = body;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new TalariaNodeClient();
    try {
      client.init({
        dsn: 'http://127.0.0.1:9',
        apiKey: 'tal_live_test',
        remoteConfig: false,
        disableDefaultIntegrations: true,
      });
      client.setExtra('plan', 'pro');
      client.setContext('checkout', { step: 'payment' });
      await client.captureException(new Error('node boom'), {
        extra: { requestId: 'r-1' },
      });
      await client.flush();
      const events = (eventBody!.input as { events: Array<Record<string, unknown>> }).events;
      assert.deepEqual(JSON.parse(String(events[0]!.extraJson)), {
        plan: 'pro',
        checkout: { step: 'payment' },
        requestId: 'r-1',
      });
    } finally {
      globalThis.fetch = originalFetch;
      await client.close();
    }
  });
});

describe('outgoing HTTP', () => {
  it('injects traceparent once tracing is on', async () => {
    const originalFetch = globalThis.fetch;
    let traceparent = '';
    let fetchTraceparent = '';
    const server = http.createServer((req, res) => {
      traceparent = String(req.headers.traceparent ?? '');
      res.statusCode = 204;
      res.end();
    });

    const client = new TalariaNodeClient();
    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const port = (server.address() as AddressInfo).port;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (String(input).includes('example.test')) {
          fetchTraceparent = headers.get('traceparent') ?? '';
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;
      client.init({
        dsn: 'http://127.0.0.1:9',
        apiKey: 'tal_live_test',
        remoteConfig: false,
        disableDefaultIntegrations: true,
      });
      installOutgoingHttpInstrumentation(client);
      client.applySdkConfig({
        schemaVersion: 1,
        revision: 'test',
        active: true,
        tracing: { enabled: true, tracesSampleRate: 1 },
      });
      client.startTransaction('incoming', { kind: 'server' });
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
          res.resume();
          res.on('end', () => resolve());
        });
        req.on('error', reject);
      });
      await fetch('https://example.test/health');
      assert.ok(client.getTraceId());
      assert.match(traceparent, new RegExp(client.getTraceId()!));
      assert.match(fetchTraceparent, new RegExp(client.getTraceId()!));
    } finally {
      await client.close();
      globalThis.fetch = originalFetch;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
