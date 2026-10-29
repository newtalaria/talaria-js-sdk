import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { ServerpodTransport } from '../src/transport/serverpod.ts';
import {
  REPLAY_SEGMENTS_PATH,
  ingestReplaySegment,
  ingestReplaySegmentBatch,
} from '../src/transport/replays.ts';
import {
  HEATMAP_SNAPSHOTS_PATH,
  uploadHeatmapSnapshot,
} from '../src/transport/heatmaps.ts';

interface Seen {
  url: URL;
  headers: Record<string, string>;
  body: Buffer;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(status: (row: Seen) => number = () => 200): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    const row: Seen = {
      url: new URL(String(input)),
      headers: { ...(init?.headers as Record<string, string>) },
      body:
        typeof body === 'string'
          ? Buffer.from(body)
          : Buffer.from(body as Uint8Array),
    };
    seen.push(row);
    return new Response(
      JSON.stringify({ replayId: row.url.searchParams.get('replayId') ?? 'r' }),
      { status: status(row), headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return seen;
}

const gz = new Uint8Array(gzipSync(Buffer.from(JSON.stringify([{ type: 4 }]))));

function segment(i: number) {
  return {
    replayId: '0b6f4a52-0000-4000-8000-000000000001',
    segmentIndex: i,
    events: [{ type: 4 }],
    startedAt: new Date('2026-10-19T05:00:00Z'),
    endedAt: new Date('2026-10-19T05:00:05Z'),
    gzip: gz,
  };
}

function transport(caps?: Record<string, boolean>) {
  const t = new ServerpodTransport({
    baseUrl: 'https://ingest.example.com',
    apiKey: 'tal_live_test',
  });
  if (caps) t.setCapabilities(caps);
  return t;
}

describe('replay segments', () => {
  it('old servers get the base64 RPC (no capability)', async () => {
    const seen = mockFetch();
    await ingestReplaySegment(transport(), segment(0));
    assert.equal(seen[0]!.url.pathname, '/v1/replays/segments');
    assert.match(seen[0]!.body.toString(), /decode\('/);
  });

  it('binaryUploads: raw gzip to the binary route, no base64', async () => {
    const seen = mockFetch();
    await ingestReplaySegment(transport({ binaryUploads: true }), segment(3));
    const row = seen[0]!;
    assert.equal(row.url.pathname, REPLAY_SEGMENTS_PATH);
    assert.equal(row.url.searchParams.get('segmentIndex'), '3');
    assert.equal(row.url.searchParams.get('eventCount'), '1');
    assert.equal(
      row.url.searchParams.get('startedAt'),
      '2026-10-19T05:00:00.000Z',
    );
    assert.deepEqual([...row.body], [...gz]);
    assert.equal(row.headers['Content-Encoding'], undefined);
  });

  it('page-close (keepalive) sends keep using the RPC', async () => {
    const seen = mockFetch();
    await ingestReplaySegment(transport({ binaryUploads: true, gzipRequests: true }), {
      ...segment(0),
      keepalive: true,
    });
    assert.equal(seen[0]!.url.pathname, '/v1/replays/segments');
    assert.equal(seen[0]!.headers['Content-Encoding'], undefined);
  });

  it('a 404 from the binary route falls back to RPC and stays there', async () => {
    const seen = mockFetch((row) => {
      // Binary uploads have raw bytes, RPC has JSON
      const isBinary = row.url.pathname === REPLAY_SEGMENTS_PATH && 
                       !row.body.toString().startsWith('{');
      return isBinary ? 404 : 200;
    });
    const t = transport({ binaryUploads: true });
    await ingestReplaySegment(t, segment(0));
    assert.deepEqual(
      seen.map((r) => r.url.pathname),
      [REPLAY_SEGMENTS_PATH, '/v1/replays/segments'],
    );
    assert.equal(t.capabilities.binaryUploads, false);
    await ingestReplaySegment(t, segment(1));
    assert.equal(seen.at(-1)!.url.pathname, '/v1/replays/segments');
  });

  it('a 429 from the binary route is a real error, not a fallback', async () => {
    mockFetch(() => 429);
    const t = transport({ binaryUploads: true });
    await assert.rejects(ingestReplaySegment(t, segment(0)));
    assert.equal(t.capabilities.binaryUploads, true);
  });

  it('batch: one binary POST per segment, prefix contract kept', async () => {
    const seen = mockFetch((row) =>
      row.url.searchParams.get('segmentIndex') === '2' ? 500 : 200,
    );
    const result = await ingestReplaySegmentBatch(
      transport({ binaryUploads: true }),
      [segment(0), segment(1), segment(2), segment(3)],
    );
    assert.equal(seen.length, 3);
    assert.equal(result.acceptedCount, 2);
    assert.equal(result.failedCount, 2);
    assert.equal(result.failures[0]!.index, 2);
  });

  it('batch falls back to the batch RPC when the route is missing', async () => {
    const seen = mockFetch((row) => {
      // Binary uploads have raw bytes, RPC has JSON
      const isBinary = row.url.pathname === REPLAY_SEGMENTS_PATH && 
                       !row.body.toString().startsWith('{');
      return isBinary ? 405 : 200;
    });
    await ingestReplaySegmentBatch(transport({ binaryUploads: true }), [
      segment(0),
      segment(1),
    ]);
    assert.deepEqual(
      seen.map((r) => r.url.pathname),
      [REPLAY_SEGMENTS_PATH, '/v1/replays/segments'],
    );
  });
});

describe('heatmap snapshot', () => {
  const params = {
    pageViewId: 'pv1',
    gzip: gz,
    viewportWidth: 1280,
    viewportHeight: 800,
    documentHeight: 2400,
    capturedAt: '2026-10-19T05:00:00.000Z',
  };

  it('binaryUploads: raw gzip to the snapshot route', async () => {
    const seen = mockFetch();
    await uploadHeatmapSnapshot(transport({ binaryUploads: true }), params);
    assert.equal(seen[0]!.url.pathname, HEATMAP_SNAPSHOTS_PATH);
    assert.equal(seen[0]!.url.searchParams.get('documentHeight'), '2400');
    assert.deepEqual([...seen[0]!.body], [...gz]);
  });

  it('without the capability it uses heatmaps/uploadSnapshot', async () => {
    const seen = mockFetch();
    await uploadHeatmapSnapshot(transport(), params);
    assert.equal(seen[0]!.url.pathname, '/v1/heatmaps/snapshots');
  });
});
