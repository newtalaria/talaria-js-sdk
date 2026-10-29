import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reportDiscards } from '../src/policy/sdk_policy.ts';
import { ingestAnalyticsEventBatch } from '../src/transport/analytics.ts';
import { ingestEventBatch } from '../src/transport/events.ts';
import { ServerpodTransport } from '../src/transport/serverpod.ts';
import { ingestSpanBatch } from '../src/transport/spans.ts';
import analyticsBody from './fixtures/analytics.json';
import clientReportsBody from './fixtures/client_reports.json';
import eventsBody from './fixtures/events.json';
import spansBody from './fixtures/spans.json';

/**
 * Exact JSON posted to ingest. Key order is part of the contract these
 * fixtures lock: events, spans, analytics (`events`), and client reports (`discards`).
 */
function assertWire(actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

async function capture(send: (transport: ServerpodTransport) => Promise<unknown>): Promise<unknown> {
  let body = '';
  const previous = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = String(init?.body ?? '');
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const transport = new ServerpodTransport({
      baseUrl: 'http://ingest.test',
      apiKey: 'tal_test_test',
    });
    await send(transport);
  } finally {
    globalThis.fetch = previous;
  }
  return JSON.parse(body);
}

describe('ingest wire JSON', () => {
  it('posts events as {"events":[...]}', async () => {
    const event = eventsBody.events[0]!;
    const body = await capture((transport) =>
      ingestEventBatch(transport, [
        {
          message: event.message,
          level: 'error',
          eventType: 'error',
          title: event.title,
          stackTrace: event.stackTrace,
          exception: event.exception,
          debugMeta: event.debugMeta,
          platform: event.platform,
          release: event.release,
          commitSha: event.commitSha,
          releaseRefKind: 'branch',
          anonymousId: event.anonymousId,
          sessionId: event.sessionId,
          replayId: event.replayId,
          url: event.url,
          tags: event.tags,
          extraJson: event.extraJson,
          userAgent: event.userAgent,
          timestamp: event.timestamp,
          traceId: event.traceId,
          spanId: event.spanId,
          breadcrumbs: event.breadcrumbs,
        },
      ]),
    );
    assertWire(body, eventsBody);
  });

  it('posts spans as {"spans":[...]}', async () => {
    const span = spansBody.spans[0]!;
    const body = await capture((transport) =>
      ingestSpanBatch(transport, [
        {
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          name: span.name,
          kind: 'server',
          startTime: span.startTime,
          endTime: span.endTime,
          status: 'ok',
          statusMessage: span.statusMessage,
          attributes: span.attributes,
          resource: span.resource,
          events: span.events,
          links: span.links,
          release: span.release,
          anonymousId: span.anonymousId,
          sessionId: span.sessionId,
          requestId: span.requestId,
        },
      ]),
    );
    assertWire(body, spansBody);
  });

  it('posts analytics as {"events":[...]}', async () => {
    const event = analyticsBody.events[0]!;
    const body = await capture((transport) =>
      ingestAnalyticsEventBatch(transport, [
        {
          eventId: event.eventId,
          name: event.name,
          kind: 'track',
          anonymousId: event.anonymousId,
          sessionId: event.sessionId,
          timestamp: event.timestamp,
          userId: event.userId,
          replayId: event.replayId,
          platform: event.platform,
          release: event.release,
          url: event.url,
          path: event.path,
          title: event.title,
          referrer: event.referrer,
          propertiesJson: event.propertiesJson,
          browserName: event.browserName,
          osName: event.osName,
          device: event.device,
          locale: event.locale,
          timezone: event.timezone,
        },
      ]),
    );
    assertWire(body, analyticsBody);
    assert.equal('analytics' in (body as object), false);
  });

  it('posts client reports as {"discards":[{"signal","reason","count"}]}', async () => {
    const body = await capture((transport) =>
      reportDiscards(transport, [
        { signal: 'events', reason: 'sample_rate', count: 4 },
        { signal: 'replays', reason: 'consent', count: 1 },
      ]),
    );
    assertWire(body, clientReportsBody);
    assert.equal('reports' in (body as object), false);
  });
});
