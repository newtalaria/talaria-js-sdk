import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Scope } from '../src/scope.ts';

describe('Scope', () => {
  it('sets and clears user id', () => {
    const scope = new Scope();
    scope.setUser({ id: 'u-1' });
    assert.equal(scope.getUserId(), 'u-1');
    scope.setUser(null);
    assert.equal(scope.getUserId(), undefined);
  });

  it('merges tags', () => {
    const scope = new Scope();
    scope.setTags({ service: 'web' });
    scope.setTag('feature', 'checkout');
    assert.deepEqual(scope.getTags(), { service: 'web', feature: 'checkout' });
  });
});
