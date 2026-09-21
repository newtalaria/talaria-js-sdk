import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Talaria } from '@newtalaria/react';
import { initClient } from '../src/client/index.ts';

type NavCall = { name?: string; url?: string };

function installWindow(pathname: string): {
  location: { pathname: string; href: string };
  popstate: Array<() => void>;
  currentchange: Array<() => void>;
  restore: () => void;
} {
  const popstate: Array<() => void> = [];
  const currentchange: Array<() => void> = [];
  const location = {
    pathname,
    href: `https://www.newtalaria.com${pathname}`,
  };
  const previous = (globalThis as { window?: unknown }).window;
  const win = {
    location,
    addEventListener(type: string, listener: () => void) {
      if (type === 'popstate') popstate.push(listener);
    },
    navigation: {
      addEventListener(type: string, listener: () => void) {
        if (type === 'currentchange') currentchange.push(listener);
      },
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
    writable: true,
  });
  return {
    location,
    popstate,
    currentchange,
    restore: () => {
      if (previous === undefined) {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        Object.defineProperty(globalThis, 'window', {
          value: previous,
          configurable: true,
          writable: true,
        });
      }
    },
  };
}

describe('initClient navigation listeners', () => {
  it('starts a navigation on popstate and Navigation API currentchange', () => {
    const navigations: NavCall[] = [];
    const originalInit = Talaria.init;
    const originalStart = Talaria.startNavigation;
    Talaria.init = () => {};
    Talaria.startNavigation = (opts) => {
      navigations.push({ name: opts?.name, url: opts?.url });
    };

    const env = installWindow('/learn/web-vitals');
    try {
      initClient({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
      });

      assert.equal(env.popstate.length, 1);
      assert.equal(env.currentchange.length, 1);

      env.popstate[0]!();
      assert.equal(navigations.length, 0);

      env.location.pathname = '/features';
      env.location.href = 'https://www.newtalaria.com/features';
      env.popstate[0]!();
      assert.deepEqual(navigations, [
        { name: '/features', url: 'https://www.newtalaria.com/features' },
      ]);

      env.location.pathname = '/docs';
      env.location.href = 'https://www.newtalaria.com/docs';
      env.currentchange[0]!();
      assert.equal(navigations.length, 2);
      assert.deepEqual(navigations[1], {
        name: '/docs',
        url: 'https://www.newtalaria.com/docs',
      });
    } finally {
      Talaria.init = originalInit;
      Talaria.startNavigation = originalStart;
      env.restore();
    }
  });
});
