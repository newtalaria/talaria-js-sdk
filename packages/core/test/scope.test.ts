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

  it('copies named context and extra onto the capture bag', () => {
    const scope = new Scope();
    scope.setExtra('plan', 'pro');
    scope.setContext('checkout', { step: 'payment' });
    assert.deepEqual(scope.mergeCaptureExtra({ requestId: 'r-1' }), {
      plan: 'pro',
      checkout: { step: 'payment' },
      requestId: 'r-1',
    });
  });

  it('lets call-site extra replace a named context and clears on null', () => {
    const scope = new Scope();
    scope.setContext('checkout', { step: 'payment' });
    scope.setExtra('plan', 'pro');
    assert.deepEqual(scope.mergeCaptureExtra({ checkout: { step: 'review' } }), {
      plan: 'pro',
      checkout: { step: 'review' },
    });
    scope.setContext('checkout', null);
    scope.setExtra('plan', null);
    assert.equal(scope.mergeCaptureExtra(), undefined);
  });
});
