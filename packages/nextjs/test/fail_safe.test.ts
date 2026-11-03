import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mintCredential, resetFailSafe } from '@newtalaria/core';
import { finalizeTalariaRelease } from '../src/build/finalize.ts';
import { withTalariaConfig } from '../src/config/index.ts';
import { main } from '../src/cli.ts';
import { captureException, captureMessage, initEdge, isEnabled } from '../src/edge/index.ts';
import { captureRequestError, initServer, withRouteHandler, withServerAction } from '../src/server/index.ts';

const SK = mintCredential({ kind: 'sk', env: 'test', cell: 'nz1', random: 'B'.repeat(43) });
const PK = mintCredential({ kind: 'pk', env: 'test', cell: 'nz1', random: 'A'.repeat(43) });
const WRONG = SK.slice(0, -1) + (SK.endsWith('0') ? '1' : '0');
const SHA = 'a'.repeat(40);

let warnings: string[] = [];
let fetchCalls = 0;
let originalWarn: typeof console.warn;
let originalLog: typeof console.log;
let originalFetch: typeof fetch;

beforeEach(() => {
  resetFailSafe();
  warnings = [];
  fetchCalls = 0;
  originalWarn = console.warn;
  originalLog = console.log;
  originalFetch = globalThis.fetch;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  console.log = () => {};
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  console.warn = originalWarn;
  console.log = originalLog;
  globalThis.fetch = originalFetch;
});

async function fakeBuild() {
  const dir = await mkdtemp(path.join(tmpdir(), 'talaria-next-failsafe-'));
  const chunks = path.join(dir, '.next', 'static', 'chunks');
  await mkdir(chunks, { recursive: true });
  await writeFile(path.join(chunks, 'main-1a.js'), 'x()\n//# sourceMappingURL=main-1a.js.map\n');
  await writeFile(path.join(chunks, 'main-1a.js.map'), JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA' }));
  return { dir, chunks };
}

describe('nextjs edge fail safe (D19)', () => {
  for (const [name, options] of [
    ['no key', {}],
    ['a malformed key', { apiKey: 'tal_live_old' }],
    ['a wrong checksum', { apiKey: WRONG }],
    ['null options', null],
  ] as Array<[string, unknown]>) {
    it(`${name}: initEdge does not throw and nothing is sent`, async () => {
      assert.doesNotThrow(() => initEdge(options as never));
      assert.equal(isEnabled(), false);
      await captureException(new Error('edge boom'));
      await captureMessage('m', 'error');
      assert.equal(fetchCalls, 0);
      assert.equal(warnings.length, 1, warnings.join('\n'));
      assert.ok(warnings[0]!.includes('Talaria is disabled'));
    });
  }

  it('transport 500 and network errors never reach the caller', async () => {
    initEdge({ apiKey: SK, url: 'http://127.0.0.1:9' });
    assert.equal(isEnabled(), true);
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response('oops', { status: 500 });
    }) as typeof fetch;
    for (let i = 0; i < 3; i++) await assert.doesNotReject(captureException(new Error('x')));
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await assert.doesNotReject(captureException(new Error('y')));
    assert.ok(warnings.filter((w) => w.includes('event ingest failed')).length <= 1, warnings.join('\n'));
  });
});

describe('nextjs server fail safe (D19)', () => {
  it('initServer with a bad key does not throw; wrappers keep the app behaviour', async () => {
    assert.doesNotThrow(() => initServer({ apiKey: 'tal_live_old' }));
    assert.doesNotThrow(() => captureRequestError(new Error('req'), { path: '/x', method: 'GET' }));
    assert.doesNotThrow(() => captureRequestError(new Error('req'), undefined as never));
    const ok = withServerAction('ok', async () => 42);
    assert.equal(await ok(), 42);
    const boom = withServerAction('boom', async () => {
      throw new Error('action boom');
    });
    await assert.rejects(() => boom(), /action boom/);
    const route = withRouteHandler('r', async () => new Response('hi'));
    assert.equal(await (await route()).text(), 'hi');
    assert.equal(fetchCalls, 0);
  });
});

describe('nextjs build fail safe (D19)', () => {
  for (const [name, apiKey] of [
    ['a malformed key', 'tal_live_old'],
    ['a wrong checksum', WRONG],
    ['a browser key', PK],
  ] as Array<[string, string]>) {
    it(`${name}: finalize warns, skips, still hides maps, never throws`, async () => {
      const { dir, chunks } = await fakeBuild();
      const result = await finalizeTalariaRelease({ projectDir: dir, release: 'r1', commitSha: SHA, apiKey, env: {}, commits: [] });
      assert.ok(result.skipped);
      assert.equal(result.mapsUploaded, false);
      assert.equal(result.mapsHidden, 1);
      assert.deepEqual(await readdir(chunks), ['main-1a.js']);
      assert.equal(fetchCalls, 0);
      assert.ok(warnings.some((w) => w.includes('source map upload skipped')));
      assert.ok(!warnings.join('\n').includes(apiKey.slice(0, 9)));
    });
  }

  it('an unreachable Talaria (or a thrown transport) never fails the build', async () => {
    const { dir } = await fakeBuild();
    globalThis.fetch = (async () => {
      throw new TypeError('getaddrinfo ENOTFOUND');
    }) as typeof fetch;
    const result = await finalizeTalariaRelease({
      projectDir: dir,
      release: 'r1',
      commitSha: SHA,
      apiKey: SK,
      url: 'http://127.0.0.1:9',
      env: {},
      commits: [],
      log: () => {},
      error: () => {},
    });
    assert.equal(result.mapsUploaded, false);
    assert.equal(result.releaseCreated, false);
  });

  it('an internal fault (unreadable project dir) is caught and logged', async () => {
    const result = await finalizeTalariaRelease({
      projectDir: '/nonexistent/talaria-dir',
      release: 'r1',
      apiKey: SK,
      url: 'http://127.0.0.1:9',
      env: {},
      commits: [],
      transport: { call: async () => { throw new Error('boom'); } },
      log: () => {},
      error: () => {},
    });
    assert.equal(result.mapsUploaded, false);
  });

  it('runAfterProductionCompile resolves with a missing or bad release key', async () => {
    const { dir } = await fakeBuild();
    for (const key of [undefined, 'tal_live_old', WRONG]) {
      const config = withTalariaConfig({}, { uploadSourceMaps: true, release: 'r1', commitSha: SHA, upload: { apiKey: key, env: {} } }) as {
        compiler: { runAfterProductionCompile: (ctx: { distDir: string; projectDir: string }) => Promise<void> };
      };
      await assert.doesNotReject(config.compiler.runAfterProductionCompile({ projectDir: dir, distDir: path.join(dir, '.next') }));
    }
    assert.equal(fetchCalls, 0);
  });

  it('talaria-nextjs upload exits 0 on a bad key; only usage errors are non-zero', async () => {
    const { dir } = await fakeBuild();
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...a: unknown[]) => {
      errors.push(a.map(String).join(' '));
    };
    try {
      assert.equal(await main(['upload', '--dir', dir, '--release', 'r1', '--commit', SHA, '--api-key', 'tal_live_old']), 0);
      assert.equal(await main(['upload', '--bogus']), 2);
      assert.equal(await main(['nope']), 2);
    } finally {
      console.error = originalError;
    }
    assert.ok(warnings.some((w) => w.includes('continuing')));
  });
});
