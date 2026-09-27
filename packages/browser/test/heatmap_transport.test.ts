import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServerpodTransport } from '../src/transport/serverpod.ts';
import {
  MAX_HEATMAP_CLICKS_PER_BATCH,
  MAX_KEEPALIVE_BODY_BYTES,
  chunkHeatmapPageViews,
  parseHeatmapBatchResponse,
  serializeHeatmapPageView,
  type HeatmapClickParams,
  type HeatmapPageViewParams,
} from '../src/transport/heatmaps.ts';
import { HeatmapRecorder } from '../src/heatmaps/heatmap_recorder.ts';
import { buildSnapshotEvents } from '../src/heatmaps/snapshot.ts';

function pageView(id: string, clicks = 0): HeatmapPageViewParams {
  const list: HeatmapClickParams[] = [];
  for (let i = 0; i < clicks; i++) {
    list.push({
      clickIndex: i,
      occurredAt: '2026-09-23T00:00:00.000Z',
      selector: 'body > main > section:nth-of-type(2) > button.primary',
      tag: 'button',
      relX: 5000,
      relY: 5000,
      pageX: 100,
      pageY: 200,
      rage: false,
      dead: false,
      error: false,
    });
  }
  return {
    pageViewId: id,
    anonymousId: 'anon',
    sessionId: 'sess',
    url: 'https://shop.test/',
    startedAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:05.000Z',
    viewportWidth: 1280,
    viewportHeight: 800,
    documentWidth: 1280,
    documentHeight: 3000,
    maxScrollDepthPx: 1600,
    initialFoldPx: 800,
    clicks: list,
  };
}

describe('heatmap transport', () => {
  it('serializes Serverpod envelopes', () => {
    const out = serializeHeatmapPageView({ ...pageView('pv', 1), device: 'desktop' });
    assert.equal(out.__className__, 'IngestHeatmapPageViewInput');
    assert.equal(out.device, 'desktop');
    assert.equal('bot' in out, false);
    const clicks = out.clicks as Array<Record<string, unknown>>;
    assert.equal(clicks[0]!.__className__, 'IngestHeatmapClickInput');
  });

  it('splits by click count and keeps every click', () => {
    const batches = chunkHeatmapPageViews([pageView('a', 1500)]);
    assert.equal(batches.length, 2);
    assert.equal(batches[0]![0]!.clicks.length, MAX_HEATMAP_CLICKS_PER_BATCH);
    const total = batches.flat().reduce((n, p) => n + p.clicks.length, 0);
    assert.equal(total, 1500);
  });

  it('keeps keepalive batches under the body limit', () => {
    const batches = chunkHeatmapPageViews(
      [pageView('a', 400), pageView('b', 100)],
      { maxBytes: MAX_KEEPALIVE_BODY_BYTES },
    );
    for (const batch of batches) {
      const size = JSON.stringify(batch.map(serializeHeatmapPageView)).length;
      assert.ok(size <= MAX_KEEPALIVE_BODY_BYTES, `batch ${size} too big`);
    }
    const total = batches.flat().reduce((n, p) => n + p.clicks.length, 0);
    assert.equal(total, 500);
  });

  it('parses snapshot requests and the enabled flag', () => {
    assert.deepEqual(
      parseHeatmapBatchResponse({
        acceptedPageViews: 1,
        acceptedClicks: 2,
        enabled: true,
        snapshotRequests: ['pv1'],
      }),
      { acceptedPageViews: 1, acceptedClicks: 2, enabled: true, snapshotRequests: ['pv1'] },
    );
    assert.equal(parseHeatmapBatchResponse({ enabled: false }).enabled, false);
  });

  it('builds a Meta + FullSnapshot pair for the viewer', () => {
    const events = buildSnapshotEvents({
      node: { type: 0 },
      href: 'https://shop.test/',
      width: 1280,
      height: 800,
      scrollX: 0,
      scrollY: 0,
      timestamp: 1,
    }) as Array<{ type: number }>;
    assert.deepEqual(
      events.map((e) => e.type),
      [4, 2],
    );
  });
});

describe('heatmap recorder', () => {
  function setup(response: Record<string, unknown>, opts?: { enabled?: () => boolean }) {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    let now = 1_000;
    const transport = new ServerpodTransport({ baseUrl: 'http://localhost:8080', apiKey: 'tal_live_x' });
    let snapshots = 0;
    const recorder = new HeatmapRecorder({
      headless: true,
      getTransport: () => transport,
      isEnabled: opts?.enabled ?? (() => true),
      getPageViewBase: () => ({
        anonymousId: 'anon',
        sessionId: 'sess',
        url: 'https://shop.test/p?token=secret',
        path: '/p',
        device: 'desktop',
      }),
      getReplayId: () => 'replay-1',
      maskAllInputs: true,
      onGlobalFailure: () => {},
      now: () => now,
      captureSnapshot: async () => {
        snapshots += 1;
        return {
          gzip: new Uint8Array([1, 2, 3]),
          viewportWidth: 1280,
          viewportHeight: 800,
          documentHeight: 3000,
          capturedAt: new Date(now),
        };
      },
    });
    return {
      calls,
      recorder,
      advance: (ms: number) => {
        now += ms;
      },
      snapshots: () => snapshots,
      restore: () => {
        globalThis.fetch = originalFetch;
      },
    };
  }

  const sample = {
    scrollY: 0,
    viewportWidth: 1280,
    viewportHeight: 800,
    documentWidth: 1280,
    documentHeight: 3000,
  };

  it('sends the pageview, finalized clicks, and uploads a requested snapshot', async () => {
    const t = setup({ acceptedPageViews: 1, acceptedClicks: 1, enabled: true, snapshotRequests: ['pv1'] });
    try {
      t.recorder.startPageView('pv1', sample);
      t.recorder.recordClick({
        selector: 'body > button',
        tag: 'button',
        relX: 5000,
        relY: 5000,
        pageX: 10,
        pageY: 10,
        clientX: 10,
        clientY: 10,
        deadEligible: true,
      });
      t.advance(3_000);
      t.recorder.tick();
      await t.recorder.flush();
      await new Promise((r) => setTimeout(r, 0));

      const ingest = t.calls.find((c) => c.url.endsWith('/heatmaps/ingestBatch'));
      assert.ok(ingest);
      const input = ingest.body.input as Record<string, unknown>;
      const pv = (input.pageViews as Array<Record<string, unknown>>)[0]!;
      assert.equal(pv.pageViewId, 'pv1');
      assert.equal(pv.replayId, 'replay-1');
      assert.equal(String(pv.url).includes('secret'), false);
      const clicks = pv.clicks as Array<Record<string, unknown>>;
      assert.equal(clicks.length, 1);
      assert.equal(clicks[0]!.dead, true);

      assert.equal(t.snapshots(), 1);
      const upload = t.calls.find((c) => c.url.endsWith('/heatmaps/uploadSnapshot'));
      assert.ok(upload);
      assert.equal((upload.body.input as Record<string, unknown>).pageViewId, 'pv1');
    } finally {
      t.restore();
    }
  });

  it('stops capturing when the server reports heatmaps disabled', async () => {
    const t = setup({ acceptedPageViews: 0, acceptedClicks: 0, enabled: false, snapshotRequests: [] });
    try {
      t.recorder.startPageView('pv1', sample);
      await t.recorder.flush();
      const before = t.calls.length;
      t.recorder.startPageView('pv2', sample);
      await t.recorder.flush();
      assert.equal(t.calls.length, before);
      assert.equal(t.recorder.currentPageViewId, null);
    } finally {
      t.restore();
    }
  });

  it('sends nothing without analytics consent', async () => {
    const t = setup({ enabled: true }, { enabled: () => false });
    try {
      t.recorder.startPageView('pv1', sample);
      await t.recorder.flush();
      assert.equal(t.calls.length, 0);
    } finally {
      t.restore();
    }
  });
});
