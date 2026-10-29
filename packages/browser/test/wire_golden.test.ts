import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';
import { ServerpodTransport } from '../src/transport/serverpod.ts';
import { ingestHeatmapBatch, uploadHeatmapSnapshot } from '../src/transport/heatmaps.ts';
import { finishReplay, ingestReplaySegment, startReplay } from '../src/transport/replays.ts';
import heatmapSnapshotsBody from './fixtures/heatmap_snapshots.json';
import heatmapsBody from './fixtures/heatmaps.json';
import replayFinishBody from './fixtures/replay_finish.json';
import replaySegmentsBody from './fixtures/replay_segments.json';
import replaysBody from './fixtures/replays.json';

/** Exact JSON for heatmaps, heatmap snapshots, replays, and replay segments. */
function assertWire(actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

function gzipBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

async function capture(
  send: (transport: ServerpodTransport) => Promise<unknown>,
): Promise<{ url: string; body: unknown }> {
  let url = '';
  let raw = '';
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input);
    raw = String(init?.body ?? '');
    return new Response('{"acceptedPageViews":1,"acceptedClicks":1,"enabled":true,"snapshotRequests":[]}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
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
  return { url, body: raw ? JSON.parse(raw) : {} };
}

describe('browser ingest wire JSON', () => {
  it('posts heatmaps as {"pageViews":[...]}', async () => {
    const pageView = heatmapsBody.pageViews[0]!;
    const { url, body } = await capture((transport) =>
      ingestHeatmapBatch(transport, [
        {
          pageViewId: pageView.pageViewId,
          anonymousId: pageView.anonymousId,
          sessionId: pageView.sessionId,
          replayId: pageView.replayId,
          url: pageView.url,
          path: pageView.path,
          startedAt: pageView.startedAt,
          updatedAt: pageView.updatedAt,
          viewportWidth: pageView.viewportWidth,
          viewportHeight: pageView.viewportHeight,
          documentWidth: pageView.documentWidth,
          documentHeight: pageView.documentHeight,
          maxScrollDepthPx: pageView.maxScrollDepthPx,
          initialFoldPx: pageView.initialFoldPx,
          release: pageView.release,
          browserName: pageView.browserName,
          osName: pageView.osName,
          device: pageView.device,
          clicks: pageView.clicks,
        },
      ]),
    );
    assert.match(url, /\/v1\/heatmaps$/);
    assertWire(body, heatmapsBody);
  });

  it('posts heatmap snapshots as base64 gzip JSON', async () => {
    const { url, body } = await capture((transport) =>
      uploadHeatmapSnapshot(transport, {
        pageViewId: heatmapSnapshotsBody.pageViewId,
        gzip: gzipBytes(heatmapSnapshotsBody.gzipBytes),
        viewportWidth: heatmapSnapshotsBody.viewportWidth,
        viewportHeight: heatmapSnapshotsBody.viewportHeight,
        documentHeight: heatmapSnapshotsBody.documentHeight,
        capturedAt: heatmapSnapshotsBody.capturedAt,
      }),
    );
    assert.match(url, /\/v1\/heatmaps\/snapshots$/);
    assertWire(body, heatmapSnapshotsBody);
  });

  it('posts replays and replay finish', async () => {
    const started = await capture((transport) =>
      startReplay(transport, {
        replayId: replaysBody.replayId,
        sessionId: replaysBody.sessionId,
        anonymousId: replaysBody.anonymousId,
        url: replaysBody.url,
        userId: replaysBody.userId,
        userAgent: replaysBody.userAgent,
      }),
    );
    assert.match(started.url, /\/v1\/replays$/);
    assertWire(started.body, replaysBody);

    const finished = await capture((transport) =>
      finishReplay(transport, { replayId: replaysBody.replayId, reason: 'hidden' }),
    );
    assert.match(finished.url, /\/v1\/replays\/11111111-1111-4111-8111-111111111111\/finish$/);
    assertWire(finished.body, replayFinishBody);
  });

  it('posts replay segments as {"segments":[...]}', async () => {
    const segment = replaySegmentsBody.segments[0]!;
    const { url, body } = await capture((transport) =>
      ingestReplaySegment(transport, {
        replayId: segment.replayId,
        segmentIndex: segment.segmentIndex,
        events: [{ type: 2 }],
        gzip: gzipBytes(segment.gzipBytes),
        startedAt: new Date(segment.startedAt),
        endedAt: new Date(segment.endedAt),
      }),
    );
    assert.match(url, /\/v1\/replays\/segments$/);
    assertWire(body, replaySegmentsBody);
  });
});
