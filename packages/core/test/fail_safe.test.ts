import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  TRANSPORT_LOG_INTERVAL_MS,
  keyPreview,
  logRateLimited,
  resetFailSafe,
  warnDisabledOnce,
} from '../src/fail_safe.ts';
import { EventIngestQueue } from '../src/transport/event_queue.ts';

let warnings: string[] = [];
let originalWarn: typeof console.warn;

beforeEach(() => {
  resetFailSafe();
  warnings = [];
  originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  console.warn = originalWarn;
});

describe('fail safe helpers (D19)', () => {
  it('keyPreview shows at most 8 characters', () => {
    assert.equal(keyPreview('tal_pk_prod_nz1_secretsecret'), 'tal_pk_p…');
    assert.equal(keyPreview('short'), 'short');
    assert.equal(keyPreview('  '), '');
    assert.equal(keyPreview(undefined), '');
  });

  it('warnDisabledOnce logs once per process and never the full key', () => {
    const key = 'tal_live_g2WhG4abcdefghijklmnop';
    assert.equal(warnDisabledOnce('@x', 'bad key', key), true);
    assert.equal(warnDisabledOnce('@x', 'bad key', key), false);
    assert.equal(warnDisabledOnce('@y', 'other', key), false);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0]!.includes('Talaria is disabled: bad key'));
    assert.ok(warnings[0]!.includes('"tal_live…"'));
    assert.ok(!warnings[0]!.includes(key.slice(0, 9)));
  });

  it('drops a duplicated SDK prefix from the reason', () => {
    warnDisabledOnce('@newtalaria/node', '@newtalaria/node: invalid API key (checksum mismatch)');
    assert.equal(
      warnings[0],
      '@newtalaria/node: Talaria is disabled: invalid API key (checksum mismatch). The app keeps running and nothing is sent.',
    );
  });

  it('logRateLimited logs once per channel per interval', () => {
    const t0 = 1_000_000;
    assert.equal(logRateLimited('a', 'first', undefined, t0), true);
    assert.equal(logRateLimited('a', 'again', undefined, t0 + 1), false);
    assert.equal(logRateLimited('b', 'other channel', undefined, t0 + 1), true);
    assert.equal(logRateLimited('a', 'later', undefined, t0 + TRANSPORT_LOG_INTERVAL_MS), true);
    assert.deepEqual(warnings, ['first', 'other channel', 'later']);
  });

  it('a broken console never throws', () => {
    console.warn = () => {
      throw new Error('console gone');
    };
    assert.doesNotThrow(() => warnDisabledOnce('@x', 'reason'));
    assert.doesNotThrow(() => logRateLimited('c', 'msg'));
  });
});

describe('EventIngestQueue fail safe', () => {
  it('a throwing onError never breaks flush', async () => {
    let sends = 0;
    const queue = new EventIngestQueue(
      async () => {
        sends += 1;
        throw new Error('HTTP 500');
      },
      () => {
        throw new Error('callback bug');
      },
    );
    await queue.enqueue({ message: 'a', level: 'error' } as never);
    await assert.doesNotReject(queue.flush());
    await queue.enqueue({ message: 'b', level: 'error' } as never);
    await assert.doesNotReject(queue.flush());
    assert.equal(sends, 2);
  });
});
