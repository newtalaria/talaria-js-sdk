import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Talaria } from '@newtalaria/browser';
import { reactErrorHandler } from '../src/error_handler.ts';
import { ErrorBoundary } from '../src/error_boundary.tsx';
import { instrumentReactRouter } from '../src/router.ts';

describe('react fail safe (D19)', () => {
  it('reactErrorHandler still calls `after` when Talaria throws or rejects', async () => {
    const original = Talaria.captureException;
    const after: unknown[] = [];
    try {
      Talaria.captureException = (() => {
        throw new Error('talaria bug');
      }) as typeof Talaria.captureException;
      const err = new Error('render failed');
      assert.doesNotThrow(() => reactErrorHandler((e) => after.push(e))(err, { componentStack: 'at X' }));
      Talaria.captureException = (async () => {
        throw new Error('talaria rejected');
      }) as typeof Talaria.captureException;
      assert.doesNotThrow(() => reactErrorHandler((e) => after.push(e))(err, {}));
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(after, [err, err]);
    } finally {
      Talaria.captureException = original;
    }
  });

  it('ErrorBoundary.componentDidCatch calls onError when Talaria throws', () => {
    const original = Talaria.captureException;
    const seen: unknown[] = [];
    try {
      Talaria.captureException = (() => {
        throw new Error('talaria bug');
      }) as typeof Talaria.captureException;
      const boundary = new ErrorBoundary({ children: null, onError: (e) => seen.push(e) });
      const err = new Error('boom');
      assert.doesNotThrow(() => boundary.componentDidCatch(err, { componentStack: '' } as never));
      assert.deepEqual(seen, [err]);
    } finally {
      Talaria.captureException = original;
    }
  });

  it('ErrorBoundary works with a disabled client (bad key)', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      Talaria.init({ apiKey: 'tal_live_old_key' });
      assert.equal(Talaria.isEnabled(), false);
      const seen: unknown[] = [];
      const boundary = new ErrorBoundary({ children: null, onError: (e) => seen.push(e) });
      boundary.componentDidCatch(new Error('x'), { componentStack: '' } as never);
      assert.equal(seen.length, 1);
      assert.deepEqual(ErrorBoundary.getDerivedStateFromError(new Error('y')).error?.message, 'y');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('instrumentReactRouter never throws when Talaria does', () => {
    const original = Talaria.startNavigation;
    try {
      Talaria.startNavigation = () => {
        throw new Error('talaria bug');
      };
      let listener: ((s: { location: { pathname: string } }) => void) | null = null;
      const stop = instrumentReactRouter({
        state: { location: { pathname: '/' } },
        subscribe(l) {
          listener = l;
          return () => {};
        },
      });
      assert.doesNotThrow(() => listener!({ location: { pathname: '/next' } }));
      stop();
    } finally {
      Talaria.startNavigation = original;
    }
  });
});
