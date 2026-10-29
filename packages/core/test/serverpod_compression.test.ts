import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  GZIP_MIN_BYTES,
  ServerpodTransport,
} from '../src/transport/serverpod.js';
import { fetchSdkConfig } from '../src/policy/sdk_policy.js';

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
  keepalive?: boolean;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(
  respond: (seen: Seen) => { status?: number; json?: unknown } = () => ({}),
): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    const row: Seen = {
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body:
        body == null
          ? Buffer.alloc(0)
          : typeof body === 'string'
            ? Buffer.from(body)
            : Buffer.from(body as Uint8Array),
      keepalive: init?.keepalive,
    };
    seen.push(row);
    const { status = 200, json = {} } = respond(row);
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return seen;
}

function decode(row: Seen): unknown {
  const raw =
    row.headers['Content-Encoding'] === 'gzip' ? gunzipSync(row.body) : row.body;
  return JSON.parse(raw.toString('utf8'));
}

const big = {
  input: {
    events: Array.from({ length: 60 }, (_, i) => ({
      message: `TypeError: checkout failed for cart ${i}`,
    })),
  },
};

function transport() {
  return new ServerpodTransport({
    baseUrl: 'https://ingest.example.com/',
    apiKey: 'tal_test_test',
  });
}

describe('ServerpodTransport gzip', () => {
  it('sends plain JSON until the server advertises gzipRequests', async () => {
    const seen = mockFetch();
    const t = transport();
    await t.call('events', 'ingestBatch', big);
    assert.equal(seen[0]!.headers['Content-Encoding'], undefined);
    assert.deepEqual(t.capabilities, {
      gzipRequests: false,
      binaryUploads: false,
    });
  });

  it('gzips large bodies once advertised; they decode to the same JSON', async () => {
    const seen = mockFetch();
    const t = transport();
    t.setCapabilities({ gzipRequests: true });
    await t.call('events', 'ingestBatch', big);
    const row = seen[0]!;
    assert.equal(row.headers['Content-Encoding'], 'gzip');
    assert.ok(row.body.length < JSON.stringify(big).length / 2);
    assert.deepEqual(decode(row), big);
  });

  it('keeps small bodies plain', async () => {
    const seen = mockFetch();
    const t = transport();
    t.setCapabilities({ gzipRequests: true });
    const small = { input: { m: 'x' } };
    assert.ok(JSON.stringify(small).length < GZIP_MIN_BYTES);
    await t.call('events', 'ingestBatch', small);
    assert.equal(seen[0]!.headers['Content-Encoding'], undefined);
  });

  it('never gzips a page-close (keepalive) send', async () => {
    const seen = mockFetch();
    const t = transport();
    t.setCapabilities({ gzipRequests: true });
    await t.call('events', 'ingestBatch', big, { keepalive: true });
    assert.equal(seen[0]!.keepalive, true);
    assert.equal(seen[0]!.headers['Content-Encoding'], undefined);
    assert.deepEqual(decode(seen[0]!), big);
  });

  it('a 415 for a gzip body resends it plain and stops compressing', async () => {
    const seen = mockFetch((row) => ({
      status: row.headers['Content-Encoding'] === 'gzip' ? 415 : 200,
    }));
    const t = transport();
    t.setCapabilities({ gzipRequests: true, binaryUploads: true });
    await t.call('events', 'ingestBatch', big);
    assert.deepEqual(
      seen.map((r) => r.headers['Content-Encoding']),
      ['gzip', undefined],
    );
    assert.deepEqual(decode(seen[0]!), decode(seen[1]!));
    assert.equal(t.capabilities.gzipRequests, false);
    assert.equal(t.capabilities.binaryUploads, true);
  });

  it('getConfig applies capabilities; an older server switches them off', async () => {
    let caps: unknown = { gzipRequests: true, binaryUploads: true };
    mockFetch(() => ({
      json: {
        schemaVersion: 1,
        revision: 'r1',
        active: true,
        ...(caps ? { capabilities: caps } : {}),
      },
    }));
    const t = transport();
    const args = { sdkName: 'browser', sdkVersion: '0', platform: 'web' };
    await fetchSdkConfig(t, args);
    assert.deepEqual(t.capabilities, {
      gzipRequests: true,
      binaryUploads: true,
    });
    caps = undefined;
    await fetchSdkConfig(t, args);
    assert.deepEqual(t.capabilities, {
      gzipRequests: false,
      binaryUploads: false,
    });
  });

  it('callBinary posts raw bytes with fields in the query string', async () => {
    const seen = mockFetch(() => ({ json: { ok: true } }));
    const t = transport();
    const bytes = new Uint8Array([0x1f, 0x8b, 1, 2, 3]);
    const out = await t.callBinary(
      '/v1/replays/segments',
      { replayId: 'r', segmentIndex: 2 },
      bytes,
    );
    assert.deepEqual(out, { ok: true });
    const row = seen[0]!;
    const url = new URL(row.url);
    assert.equal(url.pathname, '/v1/replays/segments');
    assert.equal(url.searchParams.get('segmentIndex'), '2');
    assert.equal(row.headers['Content-Type'], 'application/octet-stream');
    assert.equal(row.headers['Authorization'], 'Bearer tal_test_test');
    assert.equal(row.headers['Content-Encoding'], undefined);
    assert.deepEqual([...row.body], [...bytes]);
  });
});
