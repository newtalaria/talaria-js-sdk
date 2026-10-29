import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertBrowserCredential,
  assertReleaseCredential,
  assertServerCredential,
  checksumFor,
  mintCredential,
  parseCredential,
  resetPublishableKeyWarning,
  resolveIngestUrl,
} from '../src/credentials.ts';

const random = (ch: string) => ch.repeat(43);

describe('credential grammar', () => {
  const pk = mintCredential({ kind: 'pk', env: 'test', cell: 'nz1', random: random('A') });
  const sk = mintCredential({ kind: 'sk', env: 'prod', cell: 'eu1-k7m2p9', random: random('B') });
  const mon = mintCredential({ kind: 'mon', cell: 'nz1', random: random('C') });

  it('accepts pk, sk, and mon keys whose checksum matches', () => {
    assert.equal(parseCredential(pk).ok, true);
    assert.equal(parseCredential(sk).ok && parseCredential(sk).kind, 'sk');
    const parsed = parseCredential(mon);
    assert.equal(parsed.ok && parsed.kind, 'mon');
    assert.equal(pk.slice(-6), checksumFor(pk.slice(0, -6)));
  });

  it('rejects class-less keys, bad checksums, and short cells', () => {
    assert.equal(parseCredential('tal_test_nz1_' + random('A') + '000000').ok, false);
    assert.equal(parseCredential(pk.slice(0, -1) + '0').ok, false);
    assert.equal(parseCredential('tal_pk_test_x_' + random('A') + '000000').ok, false);
    assert.equal(parseCredential('not-a-key').ok, false);
  });

  it('derives the cell host and fails fast for self without a url', () => {
    assert.equal(resolveIngestUrl({ apiKey: pk }), 'https://ingest-nz1.newtalaria.com');
    assert.equal(
      resolveIngestUrl({ apiKey: sk, url: 'https://example.test/ingest/' }),
      'https://example.test/ingest',
    );
    const selfKey = mintCredential({
      kind: 'pk',
      env: 'dev',
      cell: 'self',
      random: random('D'),
    });
    assert.throws(
      () => resolveIngestUrl({ apiKey: selfKey }),
      /self/,
    );
    assert.equal(
      resolveIngestUrl({ apiKey: selfKey, url: 'http://127.0.0.1:8080' }),
      'http://127.0.0.1:8080',
    );
  });

  it('browser refuses sk and mon; server warns once on pk; release keys must be sk', () => {
    assert.equal(assertBrowserCredential(pk).kind, 'pk');
    assert.throws(() => assertBrowserCredential(sk), /tal_pk_/);
    assert.throws(() => assertBrowserCredential(mon), /tal_pk_/);
    resetPublishableKeyWarning();
    const warnings: string[] = [];
    assert.equal(assertServerCredential(sk, (m) => warnings.push(m)).kind, 'sk');
    assert.equal(assertServerCredential(pk, (m) => warnings.push(m)).kind, 'pk');
    assert.equal(assertServerCredential(pk, (m) => warnings.push(m)).kind, 'pk');
    assert.equal(warnings.length, 1);
    assert.throws(() => assertServerCredential(mon), /monitor/);
    assert.equal(assertReleaseCredential(sk).kind, 'sk');
    assert.throws(() => assertReleaseCredential(pk), /tal_sk_/);
  });
});
