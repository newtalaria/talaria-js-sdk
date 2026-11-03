import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mintCredential, resetFailSafe } from '@newtalaria/core';
import { TalariaNodeClient } from '../src/client.ts';
import { Talaria } from '../src/index.ts';

const SK = mintCredential({ kind: 'sk', env: 'test', cell: 'nz1', random: 'B'.repeat(43) });
const WRONG_CHECKSUM = SK.slice(0, -1) + (SK.endsWith('0') ? '1' : '0');
const MON = mintCredential({ kind: 'mon', cell: 'nz1', random: 'D'.repeat(43) });

const BAD_INITS: Array<[string, unknown]> = [
  ['no key', {}],
  ['an empty key', { apiKey: '' }],
  ['a malformed key', { apiKey: 'tal_live_g2WhG4abcdefghijklmnopqrstuvwxyz' }],
  ['a wrong checksum', { apiKey: WRONG_CHECKSUM }],
  ['a monitor token', { apiKey: MON }],
  ['a non-string key', { apiKey: { nope: true } }],
  ['null options', null],
];

let warnings: string[] = [];
let fetchCalls = 0;
let originalWarn: typeof console.warn;
let originalFetch: typeof fetch;
let envKey: string | undefined;

beforeEach(() => {
  resetFailSafe();
  warnings = [];
  fetchCalls = 0;
  envKey = process.env.TALARIA_API_KEY;
  delete process.env.TALARIA_API_KEY;
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
  if (envKey === undefined) delete process.env.TALARIA_API_KEY;
  else process.env.TALARIA_API_KEY = envKey;
});

const handlerCounts = () => ({
  exception: process.listenerCount('uncaughtException'),
  rejection: process.listenerCount('unhandledRejection'),
  beforeExit: process.listenerCount('beforeExit'),
});

describe('node fail safe: a bad key or option disables Talaria (D19)', () => {
  for (const [name, options] of BAD_INITS) {
    it(`${name}: no throw, no-op client, one warning, no handlers, no network`, async () => {
      const before = handlerCounts();
      const client = new TalariaNodeClient();
      assert.doesNotThrow(() => client.init(options as never));
      assert.equal(client.isEnabled(), false);
      assert.ok(client.getDisabledReason());
      assert.deepEqual(handlerCounts(), before);
      await client.captureException(new Error('boom'));
      await client.captureMessage('m', 'error');
      client.setUser({ id: 'u' });
      client.addBreadcrumb({ message: 'c' });
      assert.equal(client.startSpan('s'), null);
      assert.equal(client.startTransaction('t'), null);
      client.analytics.track('x', {}, { userId: 'u' });
      await client.analytics.flush();
      assert.equal(await client.flags.boolVariation('f', true), true);
      await client.flush();
      await client.close();
      assert.equal(fetchCalls, 0);
      assert.equal(warnings.length, 1, warnings.join('\n'));
      assert.ok(warnings[0]!.includes('Talaria is disabled'));
    });
  }

  it('shows at most the first 8 characters of the key', () => {
    new TalariaNodeClient().init({ apiKey: WRONG_CHECKSUM });
    assert.ok(warnings[0]!.includes(`"${WRONG_CHECKSUM.slice(0, 8)}…"`), warnings[0]);
    assert.ok(!warnings[0]!.includes(WRONG_CHECKSUM.slice(0, 9)));
  });

  it('warns once per process', () => {
    new TalariaNodeClient().init({ apiKey: 'bad' });
    new TalariaNodeClient().init({ apiKey: '' });
    assert.equal(warnings.length, 1);
  });

  it('reads a bad TALARIA_API_KEY without throwing', () => {
    process.env.TALARIA_API_KEY = 'tal_live_oldkey';
    const client = new TalariaNodeClient();
    assert.doesNotThrow(() => client.init({}));
    assert.equal(client.isEnabled(), false);
  });

  it('the Talaria facade never throws before init or with a bad key', async () => {
    assert.equal(Talaria.isEnabled(), false);
    await Talaria.captureException(new Error('before init'));
    assert.equal(await Talaria.flags.boolVariation('f', false), false);
    assert.doesNotThrow(() => Talaria.init({ apiKey: 'tal_live_x' }));
    assert.equal(Talaria.isEnabled(), false);
    await Talaria.captureMessage('after', 'error');
    assert.equal(fetchCalls, 0);
  });
});

describe('node fail safe: transport errors never reach the host', () => {
  const failures: Array<[string, () => Promise<Response>]> = [
    ['401', async () => new Response('{"className":"Unauthorized","retry":false}', { status: 401 })],
    ['500', async () => new Response('oops', { status: 500 })],
    ['a timeout', async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }],
    ['a network error', async () => {
      throw new TypeError('fetch failed');
    }],
  ];
  for (const [name, respond] of failures) {
    it(`${name}: capture and flush resolve; logs are rate-limited`, async () => {
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return respond();
      }) as typeof fetch;
      const client = new TalariaNodeClient();
      client.init({ apiKey: SK, url: 'http://127.0.0.1:9', remoteConfig: false, disableDefaultIntegrations: true });
      assert.equal(client.isEnabled(), true);
      for (let i = 0; i < 5; i++) {
        await assert.doesNotReject(client.captureException(new Error(`boom ${i}`)));
        await assert.doesNotReject(client.flush());
      }
      await assert.doesNotReject(client.close());
      assert.ok(fetchCalls >= 1);
      assert.ok(warnings.filter((w) => w.includes('event ingest failed')).length <= 1, warnings.join('\n'));
    });
  }
});
