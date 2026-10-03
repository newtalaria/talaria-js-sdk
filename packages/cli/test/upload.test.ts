import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { uploadSourceMaps } from '../src/upload.ts';

const mapJson = JSON.stringify({
  version: 3,
  file: 'main.js',
  sources: ['../src/checkout.ts'],
  names: ['placeOrder'],
  mappings: 'AAAAA',
  debugId: 'debug-1',
});

describe('sourcemaps upload', () => {
  it('defaults to localhost and release local, and posts the hashed basename', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'talaria-maps-'));
    const assets = path.join(root, 'dist', 'assets');
    await mkdir(assets, { recursive: true });
    await writeFile(path.join(assets, 'main.a1b2c3.js.map'), mapJson);
    await writeFile(path.join(root, 'dist', 'styles.css.map'), '{}');

    const requests: Array<{ url: string; init: RequestInit }> = [];
    const previous = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          id: 'map-1',
          release: 'local',
          fileName: 'main.a1b2c3.js',
          sizeBytes: mapJson.length,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const logs: string[] = [];
    try {
      const code = await uploadSourceMaps({
        cwd: root,
        argv: ['sourcemaps', 'upload', 'dist'],
        env: { TALARIA_RELEASE_KEY: 'tal_live_release' },
        log: (line) => logs.push(line),
        error: (line) => logs.push(`ERR ${line}`),
      });
      assert.equal(code, 0);
    } finally {
      globalThis.fetch = previous;
    }

    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, 'http://localhost:8080/sourceMaps/upload');
    const headers = requests[0]!.init.headers as Record<string, string>;
    assert.equal(headers['X-API-Key'], 'tal_live_release');
    const body = JSON.parse(String(requests[0]!.init.body)) as {
      input: {
        __className__: string;
        release: string;
        fileName: string;
        gzipBytes: string;
        debugId?: string;
      };
    };
    assert.equal(body.input.__className__, 'UploadSourceMapInput');
    assert.equal(body.input.release, 'local');
    assert.equal(body.input.fileName, 'main.a1b2c3.js');
    assert.equal(body.input.debugId, 'debug-1');
    const decoded = gunzipSync(Buffer.from(body.input.gzipBytes, 'base64')).toString(
      'utf8',
    );
    assert.equal(decoded, mapJson);
    assert.ok(logs.includes('http://localhost:8080 release local'));
    assert.ok(logs.includes('main.a1b2c3.js'));
    assert.equal(logs.filter((line) => line.includes('styles.css')).length, 0);
  });

  it('rejects a basename the server would refuse before uploading', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'talaria-maps-'));
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'dist', 'bad name.js.map'), mapJson);
    let called = false;
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const code = await uploadSourceMaps({
        cwd: root,
        argv: ['sourcemaps', 'upload', 'dist'],
        env: { TALARIA_API_KEY: 'tal_live_release' },
        log: () => {},
        error: () => {},
      });
      assert.equal(code, 1);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = previous;
    }
  });
});
