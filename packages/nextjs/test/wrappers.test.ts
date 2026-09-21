import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withRouteHandler, withServerAction } from '../src/server/index.ts';

describe('Next wrappers', () => {
  it('withServerAction rethrows after the action fails', async () => {
    const action = withServerAction('boom', async () => {
      throw new Error('server action boom');
    });
    await assert.rejects(() => action(), /server action boom/);
  });

  it('withRouteHandler rethrows after the handler fails', async () => {
    const handler = withRouteHandler('GET /api/boom', async () => {
      throw new Error('route handler boom');
    });
    await assert.rejects(() => handler(), /route handler boom/);
  });
});
