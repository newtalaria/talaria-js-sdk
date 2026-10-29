import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IngestError } from '../src/transport/ingest_error.ts';

describe('problem+json ingest errors', () => {
  it('treats invalid_key as a permanent global failure', () => {
    const error = IngestError.parse(
      JSON.stringify({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid API key',
        code: 'invalid_key',
        requestId: 'req_1',
      }),
    );
    assert.equal(error.code, 'invalid_key');
    assert.equal(error.message, 'Invalid API key');
    assert.equal(error.isPermanent, true);
    assert.equal(error.isGlobalCredentialFailure, true);
    assert.equal(error.isScopeOnly, false);
  });

  it('retries quota and rate limits and does not tombstone them', () => {
    for (const code of ['quota_exceeded', 'rate_limited']) {
      const error = IngestError.parse(JSON.stringify({ code, detail: code, status: 429 }));
      assert.equal(error.retry, true);
      assert.equal(error.isPermanent, false);
      assert.equal(error.isGlobalCredentialFailure, false);
    }
  });

  it('marks insufficient_scope as scope-only and wrong_cell as permanent', () => {
    const scope = IngestError.parse(JSON.stringify({ code: 'insufficient_scope', detail: 'missing flags:read' }));
    assert.equal(scope.isScopeOnly, true);
    assert.equal(scope.isPermanent, true);
    assert.equal(scope.isGlobalCredentialFailure, false);
    const cell = IngestError.parse(JSON.stringify({ code: 'wrong_cell', detail: 'use ingest-nz1' }));
    assert.equal(cell.isPermanent, true);
    assert.equal(cell.retry, false);
  });
});
