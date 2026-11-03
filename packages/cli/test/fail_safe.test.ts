import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  UPLOAD_INCOMPLETE,
  UPLOAD_OK,
  UPLOAD_USAGE,
  exitCodeFor,
  uploadSourceMaps,
} from '../src/upload.ts';

const SK = 'tal_sk_test_nz1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2zE3yZ';
const WRONG = SK.slice(0, -1) + 'Q';

async function dist(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'talaria-maps-failsafe-'));
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'main.js.map'), JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA' }));
  return root;
}

async function run(env: Record<string, string>, argv = ['source-maps', 'upload', 'dist']) {
  const root = await dist();
  const errors: string[] = [];
  const code = await uploadSourceMaps({ cwd: root, argv, env, log: () => {}, error: (l) => errors.push(l) });
  return { code, errors };
}

describe('source-maps upload fail safe (D19)', () => {
  it('a missing, malformed or wrong-checksum key returns incomplete, never throws, hides the key', async () => {
    for (const env of [{}, { TALARIA_RELEASE_KEY: 'tal_live_old_key_value' }, { TALARIA_RELEASE_KEY: WRONG }]) {
      const { code, errors } = await run(env);
      assert.equal(code, UPLOAD_INCOMPLETE);
      assert.equal(errors.length, 1);
      const key = (env as { TALARIA_RELEASE_KEY?: string }).TALARIA_RELEASE_KEY;
      if (key) assert.ok(!errors[0]!.includes(key.slice(0, 9)), errors[0]);
    }
  });

  for (const [name, respond] of [
    ['401', async () => new Response('{"className":"Unauthorized"}', { status: 401 })],
    ['500', async () => new Response('oops', { status: 500 })],
    ['a network error', async () => {
      throw new TypeError('fetch failed');
    }],
    ['a timeout', async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }],
  ] as Array<[string, () => Promise<Response>]>) {
    it(`${name}: returns incomplete and never throws`, async () => {
      const previous = globalThis.fetch;
      globalThis.fetch = respond as typeof fetch;
      try {
        const { code } = await run({ TALARIA_RELEASE_KEY: SK, TALARIA_URL: 'http://127.0.0.1:9' });
        assert.equal(code, UPLOAD_INCOMPLETE);
      } finally {
        globalThis.fetch = previous;
      }
    });
  }

  it('a bad flag is a usage error', async () => {
    const { code } = await run({ TALARIA_RELEASE_KEY: SK }, ['source-maps', 'upload', '--nope']);
    assert.equal(code, UPLOAD_USAGE);
  });

  it('the bin exits 0 unless the command line is wrong', () => {
    const warned: string[] = [];
    assert.equal(exitCodeFor(UPLOAD_OK, (l) => warned.push(l)), 0);
    assert.equal(warned.length, 0);
    assert.equal(exitCodeFor(UPLOAD_INCOMPLETE, (l) => warned.push(l)), 0);
    assert.equal(warned.length, 1);
    assert.equal(exitCodeFor(UPLOAD_USAGE, (l) => warned.push(l)), UPLOAD_USAGE);
  });
});
