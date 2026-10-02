import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServerpodTransport } from '../src/transport/serverpod.ts';
import { RecordingSpan } from '../src/tracing/span.ts';
import { Tracer } from '../src/tracing/tracer.ts';

function makeTracer(sampleRate = 1): Tracer {
  return new Tracer({
    transport: new ServerpodTransport({
      baseUrl: 'http://localhost:8080',
      apiKey: 'tal_live_test',
    }),
    sampleRate,
    resource: { 'service.name': 'test' },
    getSessionId: () => 'session',
    getAnonymousId: () => null,
    getReplayId: () => null,
  });
}

function silenceFetch(): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previous;
  };
}

function vitalSpans(tracer: Tracer): RecordingSpan[] {
  const ended = tracer['ended'] as RecordingSpan[];
  return ended.filter((span) => span.data.name === 'browser.web_vital');
}

describe('Tracer transaction lifetime', () => {
  it('ends the root at the last activity time instead of now', () => {
    const tracer = makeTracer();
    const start = new Date('2026-09-21T04:12:08.580Z');
    const last = new Date('2026-09-21T04:12:10.019Z');
    const root = tracer.startPageload({ name: '/features', url: 'https://www.newtalaria.com/features' });
    assert.ok(root instanceof RecordingSpan);
    root.data.startTime = start;
    tracer.noteActivity(last);
    tracer.endPageload();
    assert.equal(root.isEnded(), true);
    assert.equal(root.data.endTime?.toISOString(), last.toISOString());
    assert.equal(tracer.isTransactionOpen(), false);
    const durationMs = last.getTime() - start.getTime();
    assert.equal(durationMs, 1439);
    assert.notEqual(durationMs, 10_000);
  });

  it('marks an open root error even when status was already ok', () => {
    const tracer = makeTracer();
    const start = new Date('2026-09-21T04:12:08.580Z');
    const errorAt = new Date('2026-09-21T04:12:10.580Z');
    const root = tracer.startPageload({ name: '/features' });
    assert.ok(root instanceof RecordingSpan);
    root.data.startTime = start;
    root.setStatus('ok');
    tracer.markError();
    assert.equal(root.data.status, 'error');
    tracer.noteActivity(errorAt);
    tracer.endPageload(errorAt);
    assert.equal(root.data.endTime?.toISOString(), errorAt.toISOString());
    assert.equal(tracer.isTransactionOpen(), false);
  });

  it('does not reopen or extend an ended root when a late error arrives', () => {
    const tracer = makeTracer();
    const start = new Date('2026-09-21T04:12:08.580Z');
    const last = new Date('2026-09-21T04:12:10.019Z');
    const root = tracer.startPageload({ name: '/features' });
    assert.ok(root instanceof RecordingSpan);
    root.data.startTime = start;
    tracer.noteActivity(last);
    tracer.endPageload();
    const endBefore = root.data.endTime?.toISOString();
    assert.equal(root.data.status, 'ok');
    const traceId = tracer.getTraceId();
    const spanId = tracer.getSpanId();
    tracer.markError();
    assert.equal(root.isEnded(), true);
    assert.equal(root.data.status, 'ok');
    assert.equal(root.data.endTime?.toISOString(), endBefore);
    assert.equal(tracer.getTraceId(), traceId);
    assert.equal(tracer.getSpanId(), spanId);
  });

  it('starts a new traceId on SPA navigation and ends the previous root first', () => {
    const tracer = makeTracer();
    const first = tracer.startPageload({ name: '/learn/web-vitals' });
    assert.ok(first instanceof RecordingSpan);
    const firstTrace = tracer.getTraceId();
    assert.ok(firstTrace);
    const next = tracer.startNavigation({
      name: '/features',
      url: 'https://www.newtalaria.com/features',
    });
    assert.ok(next instanceof RecordingSpan);
    assert.equal(first.isEnded(), true);
    assert.notEqual(tracer.getTraceId(), firstTrace);
    assert.equal(next.data.attributes['talaria.transaction'], 'navigation');
    assert.equal(tracer.isTransactionOpen(), true);
  });

  it('does not attach automatic HTTP spans after the root has ended', () => {
    const tracer = makeTracer();
    tracer.startPageload({ name: '/features' });
    tracer.recordHttpSpan({
      method: 'GET',
      url: 'https://www.newtalaria.com/api',
      pathname: '/api',
      status: 200,
      ok: true,
      durationMs: 20,
    });
    tracer.endPageload();
    const before = tracer['spanCount'] as number;
    tracer.recordHttpSpan({
      method: 'GET',
      url: 'https://www.newtalaria.com/later',
      pathname: '/later',
      status: 200,
      ok: true,
      durationMs: 15,
    });
    assert.equal(tracer['spanCount'], before);
    assert.ok(tracer.getTraceId());
  });

  it('records a late Web Vital without extending the ended transaction', async () => {
    const restore = silenceFetch();
    try {
      const tracer = makeTracer();
      const root = tracer.startPageload({ name: '/' });
      assert.ok(root instanceof RecordingSpan);
      const last = new Date('2026-09-21T04:12:10.019Z');
      tracer.noteActivity(last);
      tracer.endPageload();
      const endBefore = root.data.endTime?.toISOString();
      const durationBefore = root.data.endTime!.getTime() - root.data.startTime.getTime();
      root.data.flushed = true;
      const at = new Date('2026-09-21T04:12:40.000Z');
      tracer.recordWebVital({ name: 'inp', value: 56, at });
      tracer.recordWebVital({ name: 'lcp', value: 3200, at });
      tracer.recordWebVital({ name: 'cls', value: 0.2, at });
      tracer.recordWebVital({ name: 'ttfb', value: 900, at });
      tracer.recordWebVital({ name: 'inp', value: 400, at });
      await tracer.flush();

      assert.equal(root.data.endTime?.toISOString(), endBefore);
      assert.equal(
        root.data.endTime!.getTime() - root.data.startTime.getTime(),
        durationBefore,
      );
      assert.equal(root.data.attributes.inp, undefined);
      const vitals = vitalSpans(tracer);
      assert.equal(vitals.length, 4);
      const inp = vitals.find((span) => span.data.attributes['browser.web_vital.name'] === 'inp');
      assert.ok(inp);
      assert.equal(inp.data.parentSpanId, root.context.spanId);
      assert.equal(inp.data.context.traceId, root.context.traceId);
      assert.equal(inp.data.attributes['browser.web_vital.value'], '56');
      assert.equal(inp.data.attributes['browser.web_vital.rating'], 'good');
      assert.equal(inp.data.attributes['http.route'], '/');
      assert.equal(inp.data.attributes['url.path'], '/');
      assert.equal(inp.data.startTime.toISOString(), endBefore);
      assert.equal(inp.data.endTime?.toISOString(), endBefore);
      assert.equal(
        vitals.filter((span) => span.data.attributes['browser.web_vital.name'] === 'inp').length,
        1,
      );
    } finally {
      restore();
    }
  });

  it('does not emit Web Vitals when the pageload was not sampled', async () => {
    const restore = silenceFetch();
    try {
      const tracer = makeTracer(0);
      tracer.startPageload({ name: '/' });
      tracer.recordWebVital({ name: 'lcp', value: 100, at: new Date() });
      await tracer.flush();
      assert.equal(vitalSpans(tracer).length, 0);
    } finally {
      restore();
    }
  });

  it('parents a Web Vital to the document pageload after SPA navigation', async () => {
    const restore = silenceFetch();
    try {
      const tracer = makeTracer();
      const root = tracer.startPageload({ name: '/docs' });
      assert.ok(root instanceof RecordingSpan);
      tracer.startNavigation({ name: '/features' });
      const at = new Date();
      tracer.recordWebVital({ name: 'cls', value: 0.05, at });
      await tracer.flush();
      const vital = vitalSpans(tracer).find(
        (span) => span.data.attributes['browser.web_vital.name'] === 'cls',
      );
      assert.ok(vital);
      assert.equal(vital.data.context.traceId, root.context.traceId);
      assert.equal(vital.data.parentSpanId, root.context.spanId);
      assert.notEqual(vital.data.context.traceId, tracer.getTraceId());
      assert.equal(vital.data.attributes['http.route'], '/docs');
      assert.equal(vital.data.attributes['url.path'], '/docs');
    } finally {
      restore();
    }
  });
});
