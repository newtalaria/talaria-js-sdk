import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { uploadSourceMaps } from '../src/upload.ts';
import sourceMapsBody from './fixtures/source_maps.json';

const SK = 'tal_sk_test_nz1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2zE3yZ';

/** Bytes of the map file. gzip of this string is the golden `gzipBytes`. */
const MAP_TEXT =
  '{"version":3,"file":"main.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA","debugId":"debug-1"}';

function assertWire(actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

describe('source map wire JSON', () => {
  it('posts /v1/source-maps as {release,fileName,gzipBytes,debugId}', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'talaria-wire-maps-'));
    const dir = path.join(root, 'static', 'js');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'main.js.map'), MAP_TEXT);
    await writeFile(
      path.join(dir, 'main.js'),
      'console.log(1)\n//# sourceMappingURL=main.js.map\n//# debugId=debug-1\n',
    );

    let body: unknown = null;
    let url = '';
    const previous = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body ?? '{}'));
      return new Response('{"id":"map-1"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const code = await uploadSourceMaps({
        cwd: root,
        argv: ['source-maps', 'upload', '.', '--release', 'main@abcdef1', '--url', 'http://ingest.test'],
        env: { TALARIA_RELEASE_KEY: SK },
        log: () => {},
        error: () => {},
      });
      assert.equal(code, 0);
    } finally {
      globalThis.fetch = previous;
    }

    assert.equal(url, 'http://ingest.test/v1/source-maps');
    assertWire(body, sourceMapsBody);
  });
});
