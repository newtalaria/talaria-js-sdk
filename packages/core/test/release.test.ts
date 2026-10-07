import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveReleaseIdentity } from '../src/release.ts';

const full = 'a8f31c2e4b6d8901234567890abcdef123456789';

describe('resolveReleaseIdentity', () => {
  it('keeps an explicit release', () => {
    const resolved = resolveReleaseIdentity({
      release: '1.4.2',
      env: {
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: full,
        GITHUB_REF_TYPE: 'branch',
      },
    });
    assert.equal(resolved.release, '1.4.2');
    assert.equal(resolved.commitSha, undefined);
    assert.equal(resolved.releaseRefKind, undefined);
  });

  it('fills GitHub Actions ref@shortsha', () => {
    const resolved = resolveReleaseIdentity({
      env: {
        GITHUB_REF_NAME: 'feature/new-checkout',
        GITHUB_SHA: 'f32a991e4b6d8901234567890abcdef123456789',
        GITHUB_REF_TYPE: 'branch',
      },
    });
    assert.equal(resolved.release, 'feature/new-checkout@f32a991');
    assert.equal(resolved.commitSha, 'f32a991e4b6d8901234567890abcdef123456789');
    assert.equal(resolved.releaseRefKind, 'branch');
  });

  it('reads a Next.js public release', () => {
    const resolved = resolveReleaseIdentity({
      env: { NEXT_PUBLIC_TALARIA_RELEASE: 'main@a8f31c2' },
    });
    assert.equal(resolved.release, 'main@a8f31c2');
  });
});
