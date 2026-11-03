import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mintCredential, resetFailSafe } from '@newtalaria/core';
import { TalariaClient } from '../src/client.ts';
import { Talaria } from '../src/index.ts';

const PK = mintCredential({ kind: 'pk', env: 'test', cell: 'nz1', random: 'A'.repeat(43) });
const SK = mintCredential({ kind: 'sk', env: 'test', cell: 'nz1', random: 'B'.repeat(43) });
const WRONG_CHECKSUM = PK.slice(0, -1) + (PK.endsWith('0') ? '1' : '0');
const OLD_LIVE_KEY = 'tal_live_g2WhG4abcdefghijklmnopqrstuvwxyz0123456789';

const BAD_INITS: Array<[string, unknown]> = [
  ['no key', { url: 'http://localhost:8080' }],
  ['an empty key', { apiKey: '   ' }],
  ['a malformed key', { apiKey: OLD_LIVE_KEY }],
  ['a wrong checksum', { apiKey: WRONG_CHECKSUM }],
  ['a secret key in the browser', { apiKey: SK }],
  ['a non-string key', { apiKey: 12345 }],
  ['null options', null],
  ['a self cell without a url', { apiKey: mintCredential({ kind: 'pk', env: 'test', cell: 'self', random: 'C'.repeat(43) }) }],
];

let warnings: string[] = [];
let fetchCalls = 0;
let originalWarn: typeof console.warn;
let originalFetch: typeof fetch;

beforeEach(() => {
  resetFailSafe();
  warnings = [];
  fetchCalls = 0;
  originalWarn = console.warn;
  originalFetch = globalThis.fetch;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  console.warn = originalWarn;
  globalThis.fetch = originalFetch;
});

async function exerciseEveryApi(client: TalariaClient): Promise<void> {
  await client.captureException(new Error('boom'));
  await client.captureMessage('hello', 'error');
  await client.warn('w');
  await client.logger({ tags: { a: 'b' } }).error('scoped');
  await client.withTags({ x: 'y' }).captureException('string error');
  client.setUser({ id: 'u1' });
  client.setExtra('k', 1);
  client.setContext('c', { a: 1 });
  client.addBreadcrumb({ message: 'crumb' });
  client.startNavigation({ name: '/x' });
  assert.equal(client.startSpan('s'), null);
  assert.equal(client.startInactiveSpan('s'), null);
  client.analytics.optIn();
  client.analytics.track('signup');
  client.analytics.identify('u1');
  client.analytics.page('/p');
  await client.analytics.flush();
  assert.equal(await client.flags.boolVariation('f', true), true);
  assert.equal(await client.flags.stringVariation('f', 'd'), 'd');
  await client.flush();
  await client.close();
}

describe('fail safe: a bad key or option disables Talaria (D19)', () => {
  for (const [name, options] of BAD_INITS) {
    it(`${name}: no throw, no-op client, one warning, no network`, async () => {
      const fetchBefore = globalThis.fetch;
      const logBefore = console.log;
      const setIntervalBefore = globalThis.setInterval;
      let intervals = 0;
      globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
        intervals += 1;
        return setIntervalBefore(...args);
      }) as typeof setInterval;
      const client = new TalariaClient();
      try {
        assert.doesNotThrow(() => client.init(options as never));
        assert.equal(client.isEnabled(), false);
        assert.ok(client.getDisabledReason());
        // No global hooks: fetch and console are not patched and no flush timer runs.
        assert.equal(globalThis.fetch, fetchBefore);
        assert.equal(console.log, logBefore);
        assert.equal(intervals, 0);
        await exerciseEveryApi(client);
      } finally {
        globalThis.setInterval = setIntervalBefore;
      }
      assert.equal(fetchCalls, 0);
      const disabled = warnings.filter((w) => w.includes('Talaria is disabled'));
      assert.equal(disabled.length, 1, warnings.join('\n'));
      assert.equal(warnings.length, 1, warnings.join('\n'));
    });
  }

  it('shows at most the first 8 characters of the key', () => {
    new TalariaClient().init({ apiKey: WRONG_CHECKSUM });
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0]!.includes(`"${WRONG_CHECKSUM.slice(0, 8)}…"`), warnings[0]);
    assert.ok(!warnings[0]!.includes(WRONG_CHECKSUM.slice(0, 9)), warnings[0]);
  });

  it('warns once per page across clients and repeated inits', () => {
    const a = new TalariaClient();
    a.init({ apiKey: OLD_LIVE_KEY });
    a.init({ apiKey: OLD_LIVE_KEY });
    new TalariaClient().init({ apiKey: '' });
    assert.equal(warnings.length, 1, warnings.join('\n'));
  });

  it('the Talaria facade never throws before init or with a bad key', async () => {
    assert.equal(Talaria.isEnabled(), false);
    await Talaria.captureException(new Error('before init'));
    assert.equal(await Talaria.flags.boolVariation('f', false), false);
    Talaria.analytics.track('x');
    assert.doesNotThrow(() => Talaria.init({ apiKey: OLD_LIVE_KEY }));
    assert.equal(Talaria.isEnabled(), false);
    await Talaria.captureMessage('after bad init', 'error');
    await Talaria.flush();
    assert.equal(fetchCalls, 0);
  });

  it('a valid key still enables Talaria', async () => {
    const client = new TalariaClient();
    client.init({ apiKey: PK, url: 'http://localhost:8080', remoteConfig: false, disableDefaultIntegrations: true });
    assert.equal(client.isEnabled(), true);
    assert.equal(client.getDisabledReason(), null);
    await client.captureException(new Error('sent'));
    await client.flush();
    await client.close();
    assert.ok(fetchCalls >= 1);
    assert.equal(warnings.filter((w) => w.includes('Talaria is disabled')).length, 0);
  });
});

describe('fail safe: transport errors never reach the host', () => {
  const failures: Array<[string, () => Promise<Response>]> = [
    ['401', async () => new Response('{"className":"Unauthorized","retry":false}', { status: 401 })],
    ['500', async () => new Response('oops', { status: 500 })],
    ['a timeout', async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }],
    ['a network error', async () => {
      throw new TypeError('fetch failed');
    }],
    ['an unreadable body', async () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })],
  ];

  for (const [name, respond] of failures) {
    it(`${name}: capture and flush resolve; logs are rate-limited`, async () => {
      let unhandled = 0;
      const onUnhandled = () => {
        unhandled += 1;
      };
      process.on('unhandledRejection', onUnhandled);
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return respond();
      }) as typeof fetch;
      const client = new TalariaClient();
      client.init({ apiKey: PK, url: 'http://localhost:8080', remoteConfig: false, disableDefaultIntegrations: true });
      try {
        for (let i = 0; i < 5; i++) {
          await client.captureException(new Error(`boom ${i}`));
          await client.flush();
        }
        await client.close();
        await new Promise((r) => setTimeout(r, 10));
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
      assert.equal(unhandled, 0);
      assert.ok(fetchCalls >= 1);
      const ingest = warnings.filter((w) => w.includes('event ingest failed'));
      assert.ok(ingest.length <= 1, warnings.join('\n'));
    });
  }
});
