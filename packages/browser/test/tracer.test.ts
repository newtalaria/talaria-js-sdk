import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServerpodTransport } from '../src/transport/serverpod.ts';
import { RecordingSpan } from '../src/tracing/span.ts';
import { Tracer } from '../src/tracing/tracer.ts';

function makeTracer(): Tracer {
  return new Tracer({
    transport: new ServerpodTransport({
      baseUrl: 'http://localhost:8080',
      apiKey: 'tal_live_test',
    }),
    sampleRate: 1,
    resource: { 'service.name': 'test' },
    environment: 'test',
    getSessionId: () => 'session',
    getReplayId: () => null,
  });
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

  it('does not grow the ended transaction with late Web Vitals', () => {
    const tracer = makeTracer();
    const root = tracer.startPageload({ name: '/' });
    assert.ok(root instanceof RecordingSpan);
    tracer.endPageload();
    root.data.flushed = true;
    const before = tracer['spanCount'] as number;
    tracer.recordWebVital({ name: 'inp', value: 56, at: new Date() });
    assert.equal(tracer['spanCount'], before);
  });
});
