import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INGEST_BLOCK_MAX_RETRY_SECONDS,
  INGEST_BLOCK_MIN_RETRY_SECONDS,
  IngestBlockGate,
  clampIngestBlockRetry,
  ingestBlockStorageKey,
  isIngestPostPath,
  parseIngestBlock,
} from '../src/transport/ingest_block.ts';
import { IngestError } from '../src/transport/ingest_error.ts';

describe('clampIngestBlockRetry', () => {
  it('clamps to 15 minutes and 24 hours', () => {
    assert.equal(clampIngestBlockRetry(60), INGEST_BLOCK_MIN_RETRY_SECONDS);
    assert.equal(clampIngestBlockRetry(undefined), INGEST_BLOCK_MIN_RETRY_SECONDS);
    assert.equal(clampIngestBlockRetry(48 * 60 * 60), INGEST_BLOCK_MAX_RETRY_SECONDS);
    assert.equal(clampIngestBlockRetry(3600), 3600);
  });
});

describe('parseIngestBlock', () => {
  it('reads ok and blocked documents', () => {
    assert.deepEqual(parseIngestBlock({ state: 'ok' }), { state: 'ok', reason: undefined, retryAfterSeconds: undefined });
    assert.deepEqual(
      parseIngestBlock({ state: 'blocked', reason: 'org_unpaid', retryAfterSeconds: 900 }),
      { state: 'blocked', reason: 'org_unpaid', retryAfterSeconds: 900 },
    );
    assert.equal(parseIngestBlock({ state: 'nope' }), null);
  });
});

describe('IngestBlockGate', () => {
  it('pauses on ingest_blocked and does not shorten a longer pause', () => {
    let now = 1_000_000;
    const warnings: string[] = [];
    const gate = new IngestBlockGate(
      () => now,
      (message) => warnings.push(message),
    );
    const error = IngestError.parse(
      JSON.stringify({
        status: 402,
        code: 'ingest_blocked',
        reason: 'org_unpaid',
        retryAfterSeconds: 900,
        detail: 'Ingest is stopped for this organisation.',
      }),
    );
    assert.equal(error.isIngestBlocked, true);
    assert.equal(error.isPermanent, false);
    assert.equal(gate.applyFromError(error), true);
    assert.equal(gate.isBlocked, true);
    assert.equal(gate.blockReason, 'org_unpaid');
    assert.equal(gate.remainingSeconds(), 900);
    assert.equal(warnings.length, 1);
    gate.applyFromError(
      IngestError.parse(JSON.stringify({ code: 'ingest_blocked', reason: 'org_unpaid', retryAfterSeconds: 60 })),
    );
    assert.equal(gate.remainingSeconds(), 900, 'must not shorten');
    gate.applyFromError(
      IngestError.parse(JSON.stringify({ code: 'ingest_blocked', reason: 'abusive', retryAfterSeconds: 86400 })),
    );
    assert.equal(gate.remainingSeconds(), 86400);
    assert.equal(warnings.length, 1, 'one warning only');
    now += 86400 * 1000;
    assert.equal(gate.isBlocked, false);
  });

  it('sdk-config ingestBlock can pause and later resume', () => {
    let now = 5_000;
    const gate = new IngestBlockGate(() => now, () => {});
    gate.applyFromDocument({ state: 'blocked', reason: 'neglected', retryAfterSeconds: 3600 });
    assert.equal(gate.isBlocked, true);
    gate.applyFromDocument({ state: 'ok' });
    assert.equal(gate.isBlocked, false);
  });

  it('remembers a block in session storage for the tab and restores it', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    let now = 10_000;
    const gate = new IngestBlockGate(() => now, () => {});
    gate.pause(900, 'trial_expired');
    gate.rememberInSession(storage, 'tal_pk_test_nz1_example');
    const key = ingestBlockStorageKey('tal_pk_test_nz1_example');
    assert.equal(store.has(key), true);
    const restored = new IngestBlockGate(() => now, () => {});
    restored.restoreFromSession(storage, 'tal_pk_test_nz1_example');
    assert.equal(restored.isBlocked, true);
    assert.equal(restored.blockReason, 'trial_expired');
    now += 900 * 1000;
    const expired = new IngestBlockGate(() => now, () => {});
    expired.restoreFromSession(storage, 'tal_pk_test_nz1_example');
    assert.equal(expired.isBlocked, false);
    assert.equal(store.has(key), false);
  });

  it('waitForPolicy settles on its own when the check never finishes', async () => {
    const gate = new IngestBlockGate(() => 0, () => {});
    gate.beginPolicyCheck();
    const start = Date.now();
    await gate.waitForPolicy(40);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 30, `settled too soon: ${elapsed}ms`);
    assert.ok(elapsed < 1000, `settled too late: ${elapsed}ms`);
  });

  it('waitForPolicy returns as soon as the check finishes', async () => {
    const gate = new IngestBlockGate(() => 0, () => {});
    gate.beginPolicyCheck();
    const pending = gate.waitForPolicy(5000);
    gate.markPolicyChecked();
    const start = Date.now();
    await pending;
    assert.ok(Date.now() - start < 500);
  });
});

describe('isIngestPostPath', () => {
  it('never skips sdk-config and skips ingest posts', () => {
    assert.equal(isIngestPostPath('v1/sdk-config', 'GET'), false);
    assert.equal(isIngestPostPath('v1/events', 'POST'), true);
    assert.equal(isIngestPostPath('v1/spans'), true);
  });
});
