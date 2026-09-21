import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANONYMOUS_ID_KEY,
  IdentityStore,
  SESSION_ID_KEY,
  SESSION_INACTIVITY_MS,
  SESSION_TOUCHED_AT_KEY,
  createMemoryStorage,
  parseFirstTouch,
  sanitizeTelemetryUrl,
  utcDateKey,
} from '../src/identity.ts';

describe('IdentityStore', () => {
  it('creates and persists anonymousId', () => {
    const storage = createMemoryStorage();
    let n = 0;
    const store = new IdentityStore(storage, {
      createId: () => `id-${++n}`,
    });
    const first = store.getAnonymousId();
    assert.equal(first, 'id-1');
    assert.equal(storage.getItem(ANONYMOUS_ID_KEY), 'id-1');

    const again = new IdentityStore(storage, {
      createId: () => `id-${++n}`,
    });
    assert.equal(again.getAnonymousId(), 'id-1');
    assert.equal(n, 1);
  });

  it('uses initialAnonymousId when storage is empty', () => {
    const store = new IdentityStore(createMemoryStorage(), {
      initialAnonymousId: 'passed-anon',
      createId: () => 'generated',
    });
    assert.equal(store.getAnonymousId(), 'passed-anon');
  });

  it('keeps sessionId across touches within 30 minutes', () => {
    const storage = createMemoryStorage();
    let now = new Date('2026-09-21T10:00:00.000Z');
    let n = 0;
    const store = new IdentityStore(storage, {
      now: () => now,
      createId: () => `id-${++n}`,
    });
    const s1 = store.touchSession();
    now = new Date('2026-09-21T10:20:00.000Z');
    const s2 = store.touchSession();
    assert.equal(s1, s2);
    assert.equal(storage.getItem(SESSION_ID_KEY), s1);
  });

  it('rotates sessionId after 30 minutes of inactivity', () => {
    const storage = createMemoryStorage();
    let now = new Date('2026-09-21T10:00:00.000Z');
    let n = 0;
    const store = new IdentityStore(storage, {
      now: () => now,
      createId: () => `id-${++n}`,
    });
    const s1 = store.touchSession();
    now = new Date(
      new Date('2026-09-21T10:00:00.000Z').getTime() + SESSION_INACTIVITY_MS + 1,
    );
    const s2 = store.touchSession();
    assert.notEqual(s2, s1);
    assert.equal(storage.getItem(SESSION_TOUCHED_AT_KEY), now.toISOString());
  });

  it('rotates sessionId at midnight UTC even if still active', () => {
    const storage = createMemoryStorage();
    let now = new Date('2026-09-21T23:50:00.000Z');
    let n = 0;
    const store = new IdentityStore(storage, {
      now: () => now,
      createId: () => `id-${++n}`,
    });
    const s1 = store.touchSession();
    now = new Date('2026-09-22T00:01:00.000Z');
    const s2 = store.touchSession();
    assert.notEqual(s2, s1);
    assert.equal(utcDateKey(now), '2026-09-22');
  });

  it('captures first-touch UTM on session start and keeps it', () => {
    const storage = createMemoryStorage();
    let now = new Date('2026-09-21T10:00:00.000Z');
    const store = new IdentityStore(storage, {
      now: () => now,
      createId: () => 'x',
    });
    store.touchSession({
      url: 'https://shop.example.com/p?utm_source=google&utm_campaign=spring&token=secret',
      referrer: 'https://google.com/search?q=1&api_key=abc',
    });
    const first = store.getFirstTouch();
    assert.equal(first.utmSource, 'google');
    assert.equal(first.utmCampaign, 'spring');
    assert.match(first.referrer ?? '', /api_key=(?:\[Filtered\]|%5BFiltered%5D)/);

    now = new Date('2026-09-21T10:05:00.000Z');
    store.touchSession({ url: 'https://shop.example.com/other' });
    assert.equal(store.getFirstTouch().utmSource, 'google');
  });

  it('reset issues a new anonymousId and session', () => {
    const storage = createMemoryStorage();
    let n = 0;
    const store = new IdentityStore(storage, {
      createId: () => `id-${++n}`,
    });
    const anon1 = store.getAnonymousId();
    const session1 = store.touchSession();
    const after = store.reset();
    assert.notEqual(after.anonymousId, anon1);
    assert.notEqual(after.sessionId, session1);
    assert.equal(store.getAnonymousId(), after.anonymousId);
  });
});

describe('parseFirstTouch / sanitizeTelemetryUrl', () => {
  it('maps utm_* query keys', () => {
    const parsed = parseFirstTouch(
      'https://ex.com/?utm_source=a&utm_medium=b&utm_campaign=c&utm_term=d&utm_content=e',
    );
    assert.deepEqual(parsed, {
      utmSource: 'a',
      utmMedium: 'b',
      utmCampaign: 'c',
      utmTerm: 'd',
      utmContent: 'e',
    });
  });

  it('redacts secrets on urls', () => {
    const out = sanitizeTelemetryUrl(
      'https://ex.com/p?q=1&token=abc#frag',
    );
    assert.match(out, /token=(?:\[Filtered\]|%5BFiltered%5D)/);
    assert.equal(out.includes('q=1'), true);
    assert.equal(out.includes('#frag'), false);
  });
});
