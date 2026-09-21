import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { CompressionStream as NodeCompressionStream } from 'node:stream/web';
import {
  computeErrorClipDeadlineMs,
  fitCompressedPrefix,
  isErrorClipBudgetExhausted,
  planOversizedRetry,
} from '../src/replay/fit_segment.ts';
import {
  MAX_COMPRESSED_SEGMENT_BYTES,
  MAX_SEGMENTS_ERROR_CLIP,
  RING_BUFFER_MS,
  RRWEB_FULL_SNAPSHOT,
  RRWEB_META,
  SEGMENT_SIZE_BYTES,
  TARGET_COMPRESSED_SEGMENT_BYTES,
  SegmentBuffer,
  type RrwebEvent,
} from '../src/replay/segment_buffer.ts';
import { TalariaClient } from '../src/client.ts';
import { parseSegmentBatchResponse } from '../src/transport/replays.ts';
import {
  consoleBreadcrumb,
  type Breadcrumb,
} from '../src/tracing/breadcrumbs.ts';

if (typeof globalThis.CompressionStream === 'undefined') {
  (
    globalThis as unknown as { CompressionStream: typeof NodeCompressionStream }
  ).CompressionStream = NodeCompressionStream;
}

function event(id: number, payload = 'x'): RrwebEvent {
  return {
    type: 3,
    data: { id, payload },
    timestamp: 1_700_000_000_000 + id,
  };
}

function meta(ts = 1): RrwebEvent {
  return {
    type: RRWEB_META,
    data: { href: 'http://x', width: 1280, height: 720 },
    timestamp: ts,
  };
}

function fullSnapshot(payload: string, ts = 2): RrwebEvent {
  return {
    type: RRWEB_FULL_SNAPSHOT,
    data: { node: { payload } },
    timestamp: ts,
  };
}

async function compress(events: RrwebEvent[]): Promise<Uint8Array> {
  return gzipSync(Buffer.from(JSON.stringify(events)));
}

describe('trimToFullSnapshot', () => {
  it('drops orphan increments before Meta+FullSnapshot', () => {
    const buf = new SegmentBuffer();
    buf.push({ type: 3, data: { source: 1 }, timestamp: 1 });
    buf.push({ type: 3, data: { source: 2 }, timestamp: 2 });
    buf.push({ type: 4, data: { href: 'http://x', width: 1, height: 1 }, timestamp: 3 });
    buf.push({ type: 2, data: { node: {} }, timestamp: 4 });
    buf.push({ type: 3, data: { source: 3 }, timestamp: 5 });
    assert.equal(buf.trimToFullSnapshot(), true);
    assert.equal(buf.length, 3);
    assert.equal(buf.hasFullSnapshot(), true);
  });

  it('returns false when no FullSnapshot exists', () => {
    const buf = new SegmentBuffer();
    buf.push({ type: 3, data: {}, timestamp: 1 });
    assert.equal(buf.trimToFullSnapshot(), false);
  });
});

describe('trimRing paint base', () => {
  it('drops a FullSnapshot older than RING_BUFFER_MS (idle/away gap)', () => {
    const buf = new SegmentBuffer();
    const t0 = 1_700_000_000_000;
    buf.push(meta(t0));
    buf.push(fullSnapshot('dom', t0 + 1));
    buf.push({ type: 3, data: { source: 1 }, timestamp: t0 + 5_000 });
    // User returns after the ring window; only a fresh increment remains.
    const now = t0 + RING_BUFFER_MS + 10_000;
    buf.push({ type: 3, data: { source: 2 }, timestamp: now });
    buf.trimRing(now);
    assert.equal(buf.hasFullSnapshot(), false);
    assert.equal(buf.length, 1);
  });

  it('keeps a FullSnapshot that still falls inside the ring window', () => {
    const buf = new SegmentBuffer();
    const t0 = 1_700_000_000_000;
    buf.push(meta(t0));
    buf.push(fullSnapshot('dom', t0 + 1));
    buf.push({ type: 3, data: { source: 1 }, timestamp: t0 + 30_000 });
    buf.trimRing(t0 + 30_000);
    assert.equal(buf.hasFullSnapshot(), true);
    assert.ok(buf.length >= 3);
  });

  it('a checkout FullSnapshot after trim restores a usable paint base', () => {
    const buf = new SegmentBuffer();
    const t0 = 1_700_000_000_000;
    buf.push(meta(t0));
    buf.push(fullSnapshot('old', t0 + 1));
    const now = t0 + RING_BUFFER_MS + 5_000;
    buf.push({ type: 3, data: { source: 1 }, timestamp: now });
    buf.trimRing(now);
    assert.equal(buf.hasFullSnapshot(), false);

    buf.push(meta(now + 1));
    buf.push(fullSnapshot('fresh', now + 2));
    buf.push({ type: 3, data: { source: 2 }, timestamp: now + 3 });
    assert.equal(buf.trimToFullSnapshot(), true);
    assert.equal(buf.hasFullSnapshot(), true);
    assert.equal(buf.length, 3);
  });
});

describe('fitCompressedPrefix', () => {
  it('never returns gzip larger than TARGET', async () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      event(i, 'y'.repeat(20_000)),
    );
    const fitted = await fitCompressedPrefix(events, compress);
    assert.ok(fitted);
    assert.ok(fitted.gzip.length <= TARGET_COMPRESSED_SEGMENT_BYTES);
    assert.ok(fitted.events.length >= 1);
    assert.equal(
      fitted.events.length + fitted.remainder.length,
      events.length,
    );
  });

  it('drops a single unsplittable event and continues', async () => {
    const { randomBytes } = await import('node:crypto');
    const huge: RrwebEvent = {
      type: 2,
      data: { html: randomBytes(1_400_000).toString('base64') },
      timestamp: 1,
    };
    const small = event(2, 'ok');
    const alone = await compress([huge]);
    assert.ok(
      alone.length > TARGET_COMPRESSED_SEGMENT_BYTES,
      `fixture must exceed TARGET (got ${alone.length})`,
    );
    const fitted = await fitCompressedPrefix([huge, small], compress);
    assert.ok(fitted);
    assert.equal(fitted.events.length, 1);
    assert.equal(fitted.events[0]?.data, small.data);
    assert.ok(fitted.gzip.length <= TARGET_COMPRESSED_SEGMENT_BYTES);
  });

  it('with atomicMinCount keeps Meta+FullSnapshot together', async () => {
    const fs = fullSnapshot('z'.repeat(50_000));
    const events = [meta(), fs, event(3, 'after')];
    const fitted = await fitCompressedPrefix(
      events,
      compress,
      TARGET_COMPRESSED_SEGMENT_BYTES,
      MAX_COMPRESSED_SEGMENT_BYTES,
      { atomicMinCount: 2 },
    );
    assert.ok(fitted);
    assert.ok(fitted.events.length >= 2);
    assert.equal(fitted.events[0]?.type, RRWEB_META);
    assert.equal(fitted.events[1]?.type, RRWEB_FULL_SNAPSHOT);
    assert.ok(fitted.events.some((e) => e.type === RRWEB_FULL_SNAPSHOT));
  });

  it('with atomicMinCount returns null when paint base exceeds hardCap', async () => {
    const { randomBytes } = await import('node:crypto');
    const huge = fullSnapshot(randomBytes(1_400_000).toString('base64'));
    const alone = await compress([meta(), huge]);
    assert.ok(
      alone.length > MAX_COMPRESSED_SEGMENT_BYTES,
      `fixture must exceed hardCap (got ${alone.length})`,
    );
    const fitted = await fitCompressedPrefix(
      [meta(), huge, event(3)],
      compress,
      TARGET_COMPRESSED_SEGMENT_BYTES,
      MAX_COMPRESSED_SEGMENT_BYTES,
      { atomicMinCount: 2 },
    );
    assert.equal(fitted, null);
  });
});

describe('takeByEstimatedBytes paint base', () => {
  it('does not split Meta from FullSnapshot when estimate exceeds soft take', () => {
    // Reproduce the production failure: FS estimate > SEGMENT_SIZE_BYTES so a
    // naive take would keep Meta alone.
    const bulky = 'b'.repeat(SEGMENT_SIZE_BYTES); // ~800k chars → estimate >> soft take
    const buf = new SegmentBuffer();
    buf.push(meta(1));
    buf.push(fullSnapshot(bulky, 2));
    buf.push(event(3, 'incr'));

    const without = buf.takeByEstimatedBytes(SEGMENT_SIZE_BYTES);
    // Reset and compare with keepPaintBaseTogether — but buffer already drained.
    assert.equal(without.length, 1);
    assert.equal(without[0]?.type, RRWEB_META);

    const buf2 = new SegmentBuffer();
    buf2.push(meta(1));
    buf2.push(fullSnapshot(bulky, 2));
    buf2.push(event(3, 'incr'));
    const withPaint = buf2.takeByEstimatedBytes(SEGMENT_SIZE_BYTES, {
      keepPaintBaseTogether: true,
    });
    assert.ok(withPaint.length >= 2);
    assert.equal(withPaint[0]?.type, RRWEB_META);
    assert.equal(withPaint[1]?.type, RRWEB_FULL_SNAPSHOT);
    assert.equal(buf2.length, 1); // increment left
  });
});

describe('error clip budgets', () => {
  it('stops at 12 segments even if bytes remain', () => {
    assert.equal(
      isErrorClipBudgetExhausted({
        segmentIndex: MAX_SEGMENTS_ERROR_CLIP,
        uploadedCompressedBytes: 1,
      }),
      true,
    );
    assert.equal(
      isErrorClipBudgetExhausted({
        segmentIndex: MAX_SEGMENTS_ERROR_CLIP - 1,
        uploadedCompressedBytes: 1,
      }),
      false,
    );
  });

  it('stops at 2MiB compressed', () => {
    assert.equal(
      isErrorClipBudgetExhausted({
        segmentIndex: 0,
        uploadedCompressedBytes: 2 * 1024 * 1024,
      }),
      true,
    );
  });
});

describe('error clip wall', () => {
  it('is absolute — repeated schedule uses the same deadline', () => {
    const started = 1_000_000;
    const afterMs = 15_000;
    const first = computeErrorClipDeadlineMs(started, afterMs);
    // Later "error" must not push the wall: same started + afterMs.
    const second = computeErrorClipDeadlineMs(started, afterMs);
    assert.equal(first, second);
    assert.equal(first, started + afterMs + 5_000);
  });
});

describe('oversized retry plan', () => {
  it('never re-queues an identical single-event payload', () => {
    const one = [event(1)];
    assert.deepEqual(planOversizedRetry(one), { action: 'drop' });
  });

  it('bisects multi-event payloads', () => {
    const events = [event(1), event(2), event(3)];
    const plan = planOversizedRetry(events);
    assert.equal(plan.action, 'bisect');
    if (plan.action === 'bisect') {
      assert.equal(plan.left.length + plan.right.length, 3);
    }
  });
});

describe('lifecycle', () => {
  it('close() then init() succeeds (Strict Mode remount)', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0] ?? ''));
    };

    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'test',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });
      await client.close();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'test',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });
      await client.close();
      assert.equal(
        warnings.some((w) => w.includes('already initialized')),
        false,
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('event ↔ replay link after finish', () => {
  it('keeps linkableReplayId when finish resets buffer mode', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'test',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1,
        replaysErrorAfterMs: 15_000,
        disableDefaultIntegrations: true,
      });

      const anyClient = client as unknown as {
        uploadEnabled: boolean;
        markUploadStarted: () => void;
        segmentIndex: number;
        replayId: string | null;
        linkableReplayId: string | null;
        startedOnServer: boolean;
        finishOnServer: (opts: {
          keepalive: boolean;
          reason: string;
        }) => Promise<void>;
        resetToBufferMode: () => void;
      };

      const activeId = anyClient.replayId;
      anyClient.uploadEnabled = true;
      anyClient.markUploadStarted();
      anyClient.segmentIndex = 3;
      anyClient.startedOnServer = true;
      await anyClient.finishOnServer({
        keepalive: false,
        reason: 'error_clip_budget',
      });
      anyClient.resetToBufferMode();

      assert.equal(anyClient.linkableReplayId, activeId);
      assert.equal(client.getReplayId(), activeId);
      await client.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('permanent ingest circuit breaker', () => {
  it('stops further captures after invalid API key (retry: false)', async () => {
    let ingestCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events/ingest')) {
        ingestCalls += 1;
        return new Response(
          JSON.stringify({
            __className__: 'ApiUnauthorizedException',
            message: 'Invalid API key',
            retry: false,
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0] ?? ''));
    };

    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });

      await client.captureException(new Error('boom'));
      await client.captureException(new Error('boom again'));
      await client.captureMessage('should not ingest');

      assert.equal(ingestCalls, 1);
      assert.equal(
        warnings.some((w) =>
          w.includes('event ingest disabled after permanent client error'),
        ),
        true,
      );
      await client.close();
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });

  it('does not disable ingest on quota (retry: true)', async () => {
    let ingestCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events/ingest')) {
        ingestCalls += 1;
        return new Response(
          JSON.stringify({
            className: 'ApiConflictException',
            message: 'quota exceeded',
            retry: true,
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });

      await client.captureException(new Error('boom'));
      await client.captureException(new Error('boom again'));

      assert.equal(ingestCalls, 2);
      await client.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not disable ingest on HTTP 503', async () => {
    let ingestCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events/ingest')) {
        ingestCalls += 1;
        return new Response('unavailable', { status: 503 });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });

      await client.captureException(new Error('boom'));
      await client.captureException(new Error('boom again'));

      assert.equal(ingestCalls, 2);
      await client.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('parseSegmentBatchResponse', () => {
  it('reads acceptedCount and failures from a Serverpod body', () => {
    const parsed = parseSegmentBatchResponse(
      {
        __className__: 'IngestReplaySegmentBatchResponse',
        replayId: 'r1',
        acceptedCount: 2,
        failedCount: 1,
        failures: [{ index: 2, message: 'segment exceeds max compressed size' }],
      },
      'fallback',
    );
    assert.equal(parsed.replayId, 'r1');
    assert.equal(parsed.acceptedCount, 2);
    assert.equal(parsed.failedCount, 1);
    assert.equal(parsed.failures[0]?.index, 2);
  });
});

describe('replay segment batch + breadcrumbs', () => {
  function seedErrorClipBuffer(client: TalariaClient): void {
    const anyClient = client as unknown as {
      buffer: SegmentBuffer;
    };
    const t0 = Date.now();
    anyClient.buffer.push(meta(t0));
    anyClient.buffer.push(fullSnapshot('paint-base', t0 + 1));
    for (let i = 0; i < 16; i++) {
      anyClient.buffer.push({
        type: 3,
        data: { html: randomBytes(80_000).toString('base64') },
        timestamp: t0 + 2 + i,
      });
    }
  }

  function collectCalls(): {
    urls: string[];
    eventBodies: Array<Record<string, unknown>>;
    restore: () => void;
  } {
    const urls: string[] = [];
    const eventBodies: Array<Record<string, unknown>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/events/ingest') && typeof init?.body === 'string') {
        eventBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      if (url.includes('/replays/ingestSegmentBatch')) {
        let acceptedCount = 12;
        if (typeof init?.body === 'string') {
          try {
            const parsed = JSON.parse(init.body) as {
              input?: { segments?: unknown[] };
            };
            acceptedCount = parsed.input?.segments?.length ?? 12;
          } catch {
            // ignore
          }
        }
        return new Response(
          JSON.stringify({
            __className__: 'IngestReplaySegmentBatchResponse',
            replayId: 'batch-replay',
            acceptedCount,
            failedCount: 0,
            segments: [],
            failures: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    return {
      urls,
      eventBodies,
      restore: () => {
        globalThis.fetch = originalFetch;
      },
    };
  }

  it('uploads an error clip as one ingestSegmentBatch POST', async () => {
    const { urls, restore } = collectCalls();
    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'test',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1,
        disableDefaultIntegrations: true,
      });
      seedErrorClipBuffer(client);
      await client.captureException(new Error('$current_tag is not defined'));
      await client.close();

      const batchCalls = urls.filter((u) =>
        u.includes('/replays/ingestSegmentBatch'),
      );
      const singleCalls = urls.filter((u) =>
        u.endsWith('/replays/ingestSegment'),
      );
      assert.ok(batchCalls.length >= 1, `expected batch upload, got ${urls.join(', ')}`);
      assert.equal(singleCalls.length, 0);
    } finally {
      restore();
    }
  });

  it('snapshots breadcrumbs before replay flush and drops Talaria ingest URLs', async () => {
    const { eventBodies, restore } = collectCalls();
    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'test',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1,
        disableDefaultIntegrations: true,
      });
      const anyClient = client as unknown as {
        breadcrumbs: { add: (crumb: Breadcrumb) => void; snapshot: () => Breadcrumb[] };
      };
      anyClient.breadcrumbs.add(consoleBreadcrumb('info', 'user click'));
      seedErrorClipBuffer(client);

      await client.captureException(new Error('boom'));

      const ingest = eventBodies.find((body) => {
        const input = body.input as Record<string, unknown> | undefined;
        return (
          input?.__className__ === 'IngestEventInput' ||
          input?.__className__ === 'IngestEventBatchInput'
        );
      });
      assert.ok(ingest, 'expected events/ingest body');
      const raw = ingest!.input as Record<string, unknown>;
      const input =
        raw.__className__ === 'IngestEventBatchInput'
          ? ((raw.events as Array<Record<string, unknown>>)[0] ?? {})
          : raw;
      const crumbs = (input.breadcrumbs as Array<{ message?: string }>) ?? [];
      assert.ok(
        crumbs.some((c) => c.message === 'user click'),
        'kept pre-error breadcrumb',
      );
      assert.equal(
        crumbs.some((c) => (c.message ?? '').includes('/replays/')),
        false,
        'did not attach replay ingest breadcrumbs',
      );

      const leftover = anyClient.breadcrumbs.snapshot();
      assert.equal(
        leftover.some((c) => (c.message ?? '').includes('/replays/')),
        false,
        'did not record Talaria replay URLs into the live breadcrumb buffer',
      );
      await client.close();
    } finally {
      restore();
    }
  });
});
