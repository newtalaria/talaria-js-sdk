import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reactErrorHandler } from '../src/error_handler.ts';
import { Talaria } from '@newtalaria/browser';

describe('reactErrorHandler', () => {
  it('forwards the error to Talaria.captureException', async () => {
    const captured: unknown[] = [];
    const original = Talaria.captureException;
    Talaria.captureException = (async (error: unknown) => {
      captured.push(error);
    }) as typeof Talaria.captureException;

    try {
      const handler = reactErrorHandler();
      const err = new Error('render failed');
      handler(err, { componentStack: 'at Boom' });
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(captured[0], err);
    } finally {
      Talaria.captureException = original;
    }
  });
});
