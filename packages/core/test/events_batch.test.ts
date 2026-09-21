import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ingestEvent, ingestEventBatch } from '../src/transport/events.ts';
import { ServerpodTransport } from '../src/transport/serverpod.ts';

describe('event batch ingest', () => {
  it('posts IngestEventBatchInput even for a single event', async () => {
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
      await ingestEvent(transport, {
        message: 'hello',
        environment: 'development',
        level: 'error',
      });
      assert.match(url, /\/events\/ingestBatch$/);
      const input = body!.input as Record<string, unknown>;
      assert.equal(input.__className__, 'IngestEventBatchInput');
      const events = input.events as Array<Record<string, unknown>>;
      assert.equal(events.length, 1);
      assert.equal(events[0]!.__className__, 'IngestEventInput');
      assert.equal(events[0]!.message, 'hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('batches multiple events in one call', async () => {
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
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      await ingestEventBatch(transport, [
        { message: 'a', environment: 'production' },
        { message: 'b', environment: 'production' },
      ]);
      const input = body!.input as Record<string, unknown>;
      const events = input.events as Array<Record<string, unknown>>;
      assert.equal(events.length, 2);
      assert.equal(events[0]!.message, 'a');
      assert.equal(events[1]!.message, 'b');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
