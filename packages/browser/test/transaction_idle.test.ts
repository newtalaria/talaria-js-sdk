import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, mock } from 'node:test';
import { TalariaClient } from '../src/client.ts';
import { RecordingSpan } from '../src/tracing/span.ts';
import { Tracer } from '../src/tracing/tracer.ts';

type ClientInternals = {
  tracer: Tracer | null;
  pageloadIdleTimer: ReturnType<typeof setTimeout> | null;
  pageloadMaxTimer: ReturnType<typeof setTimeout> | null;
  armPageloadIdleTimer: () => void;
};

function internals(client: TalariaClient): ClientInternals {
  return client as unknown as ClientInternals;
}

function pageload(tracer: Tracer): RecordingSpan {
  const root = (tracer as unknown as { pageload: RecordingSpan | null }).pageload;
  assert.ok(root instanceof RecordingSpan);
  return root;
}

function eventInput(body: Record<string, unknown>): Record<string, unknown> {
  const raw = body.input as Record<string, unknown>;
  if (raw.__className__ === 'IngestEventBatchInput') {
    return (raw.events as Array<Record<string, unknown>>)[0]!;
  }
  return raw;
}

function installFetchCapture(): { calls: Array<{ url: string; body: Record<string, unknown> }>; restore: () => void } {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(_input instanceof Request ? _input.url : _input);
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    } catch {
      body = {};
    }
    calls.push({ url, body });
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function initTracedClient(): TalariaClient {
  const client = new TalariaClient();
  client.init({
    dsn: 'http://localhost:8080',
    apiKey: 'tal_live_test',
    environment: 'development',
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    disableDefaultIntegrations: true,
    enableTracing: true,
    tracesSampleRate: 1,
  });
  return client;
}

function withFakeTimeouts<T>(fn: () => T): T {
  mock.timers.enable(['setTimeout']);
  try {
    return fn();
  } finally {
    mock.timers.reset();
  }
}

describe('client transaction idle and error finalization', () => {
  it('does not keep a fixed 10s pageload finalize timer', () => {
    const src = readFileSync(join(process.cwd(), 'src/client.ts'), 'utf8');
    assert.equal(src.includes('PAGELOAD_FINALIZE_MS'), false);
    assert.match(src, /TRANSACTION_IDLE_MS = 2_000/);
    assert.match(src, /TRANSACTION_MAX_MS = 30_000/);
    assert.match(src, /clearPageloadTimers/);
  });

  it('arms idle and max timers, ends on idle, and clears them on close', async (t) => {
    const { restore } = installFetchCapture();
    t.after(restore);

    const client = withFakeTimeouts(() => {
      const started = initTracedClient();
      const inner = internals(started);
      assert.ok(inner.pageloadIdleTimer);
      assert.ok(inner.pageloadMaxTimer);
      assert.equal(inner.tracer?.isTransactionOpen(), true);

      inner.tracer?.recordHttpSpan({
        method: 'GET',
        url: 'https://www.newtalaria.com/api/contact',
        pathname: '/api/contact',
        status: 200,
        ok: true,
        durationMs: 20,
      });
      inner.armPageloadIdleTimer();
      assert.ok(inner.pageloadIdleTimer);

      mock.timers.tick(1999);
      assert.equal(inner.tracer?.isTransactionOpen(), true);
      mock.timers.tick(2);
      assert.equal(inner.tracer?.isTransactionOpen(), false);
      return started;
    });

    await client.close();
    assert.equal(internals(client).pageloadIdleTimer, null);
    assert.equal(internals(client).pageloadMaxTimer, null);
  });

  it('cancels idle and ends the open root at the error time', async (t) => {
    const { calls, restore } = installFetchCapture();
    t.after(restore);

    const { client, tracer, root } = withFakeTimeouts(() => {
      const started = initTracedClient();
      const tracer = internals(started).tracer;
      assert.ok(tracer);
      const root = pageload(tracer);
      root.setStatus('ok');
      mock.timers.tick(1999);
      assert.equal(tracer.isTransactionOpen(), true);
      return { client: started, tracer, root };
    });

    await client.captureException(new Error('Talaria browser logging test'));

    assert.equal(tracer.isTransactionOpen(), false);
    assert.equal(root.data.status, 'error');
    assert.ok(root.data.endTime);
    assert.equal(internals(client).pageloadIdleTimer, null);
    const traceId = tracer.getTraceId();
    const spanId = tracer.getSpanId();

    await client.close();
    const event = calls.find((c) => c.url.includes('/events/ingest'));
    assert.ok(event);
    const input = eventInput(event.body);
    assert.equal(input.traceId, traceId);
    assert.equal(input.spanId, spanId);
  });

  it('does not extend the root when an error arrives after idle', async (t) => {
    const { calls, restore } = installFetchCapture();
    t.after(restore);

    const { client, tracer, root, endBefore, traceId, spanId } = withFakeTimeouts(() => {
      const started = initTracedClient();
      const tracer = internals(started).tracer;
      assert.ok(tracer);
      const root = pageload(tracer);
      const start = new Date('2026-09-21T04:12:08.580Z');
      const last = new Date('2026-09-21T04:12:10.019Z');
      root.data.startTime = start;
      tracer.noteActivity(last);

      mock.timers.tick(2001);
      assert.equal(tracer.isTransactionOpen(), false);
      assert.equal(root.data.endTime?.toISOString(), last.toISOString());
      assert.equal(root.data.status, 'ok');
      assert.equal(last.getTime() - start.getTime(), 1439);

      return {
        client: started,
        tracer,
        root,
        endBefore: root.data.endTime?.toISOString(),
        traceId: tracer.getTraceId(),
        spanId: tracer.getSpanId(),
      };
    });

    await client.captureException(new Error('Talaria browser logging test'));

    assert.equal(root.isEnded(), true);
    assert.equal(root.data.status, 'ok');
    assert.equal(root.data.endTime?.toISOString(), endBefore);
    assert.equal(tracer.isTransactionOpen(), false);

    await client.close();
    const event = calls.find((c) => c.url.includes('/events/ingest'));
    assert.ok(event);
    const input = eventInput(event.body);
    assert.equal(input.traceId, traceId);
    assert.equal(input.spanId, spanId);
  });
});
