import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TalariaClient } from '../src/client.ts';
import { policyDocument } from './policy_fixture.ts';

class Emitter {
  private listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, handler: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, handler: (event: Event) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  dispatch(type: string, detail?: unknown): void {
    const event = { type, detail } as Event;
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
}

function measurementPolicy() {
  return policyDocument({
    tracing: { enabled: false, tracesSampleRate: 0 },
    analytics: { enabled: true },
    replay: {
      enabled: true,
      sessionSampleRate: 1,
      errorSampleRate: 1,
      maxDurationMs: 300000,
      maskAllInputs: true,
      blockSelectors: [],
    },
  });
}

function openClient(options?: { publicAnalytics?: boolean }): TalariaClient {
  const client = new TalariaClient();
  client.init({
    dsn: 'http://localhost:8080',
    apiKey: 'tal_live_test',
    remoteConfig: false,
    disableDefaultIntegrations: true,
    publicAnalytics: options?.publicAnalytics,
  });
  return client;
}

function installFetch(): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return urls;
}

function clearBannerGlobals(): void {
  const host = globalThis as {
    window?: unknown;
    document?: unknown;
    dataLayer?: unknown;
    getCkyConsent?: unknown;
    Cookiebot?: unknown;
  };
  delete host.window;
  delete host.document;
  delete host.dataLayer;
  delete host.getCkyConsent;
  delete host.Cookiebot;
}

describe('banner consent', () => {
  it('leaves analytics off and still records replay when no banner is present', async () => {
    const urls = installFetch();
    const client = openClient();
    try {
      client.applySdkConfig(measurementPolicy());
      assert.equal(client.analytics.isEnabled(), false);
      assert.equal(typeof client.getReplayId(), 'string');

      client.analytics.track('product_viewed');
      await client.analytics.flush();
      assert.equal(
        urls.some((url) => url.includes('/analytics/')),
        false,
      );

      client.analytics.optIn();
      assert.equal(client.analytics.isEnabled(), true);
      client.analytics.track('product_viewed');
      await client.analytics.flush();
      assert.equal(
        urls.some((url) => url.includes('/analytics/')),
        true,
      );
    } finally {
      await client.close();
      clearBannerGlobals();
    }
  });

  it('opts in and allows replay when CookieYes analytics is already granted', async () => {
    const emitter = new Emitter();
    Object.assign(globalThis, { window: emitter, document: emitter });
    (globalThis as { getCkyConsent?: () => unknown }).getCkyConsent = () => ({
      categories: { analytics: true },
      isUserActionCompleted: true,
    });
    installFetch();
    const client = openClient();
    try {
      client.applySdkConfig(measurementPolicy());
      assert.equal(client.analytics.isEnabled(), true);
      assert.equal(typeof client.getReplayId(), 'string');
    } finally {
      await client.close();
      clearBannerGlobals();
    }
  });

  it('holds replay when CookieYes is present and analytics is not granted', async () => {
    const urls = installFetch();
    const emitter = new Emitter();
    Object.assign(globalThis, { window: emitter, document: emitter });
    const client = openClient();
    try {
      emitter.dispatch('cookieyes_banner_load', {
        categories: { analytics: false },
        isUserActionCompleted: false,
      });
      client.applySdkConfig(measurementPolicy());
      assert.equal(client.analytics.isEnabled(), false);
      assert.equal(client.getReplayId(), null);
      await Promise.resolve();
      assert.equal(
        urls.some((url) => url.includes('/replays/')),
        false,
      );

      await client.captureException(new Error('still captured'));
      await client.flush();
      assert.equal(
        urls.some((url) => url.includes('/events/ingestBatch')),
        true,
      );
    } finally {
      await client.close();
      clearBannerGlobals();
    }
  });

  it('follows a CookieYes choice that arrives after init', async () => {
    const urls = installFetch();
    const emitter = new Emitter();
    Object.assign(globalThis, { window: emitter, document: emitter });
    const client = openClient();
    try {
      client.applySdkConfig(measurementPolicy());
      assert.equal(typeof client.getReplayId(), 'string');

      emitter.dispatch('cookieyes_banner_load', {
        categories: { analytics: false },
        isUserActionCompleted: false,
      });
      assert.equal(client.getReplayId(), null);
      assert.equal(client.analytics.isEnabled(), false);

      emitter.dispatch('cookieyes_consent_update', {
        accepted: ['necessary', 'analytics'],
        rejected: [],
      });
      assert.equal(client.analytics.isEnabled(), true);
      assert.equal(typeof client.getReplayId(), 'string');
      await client.analytics.flush();
      const grantedPosts = urls.filter((url) => url.includes('/analytics/')).length;

      emitter.dispatch('cookieyes_consent_update', {
        accepted: ['necessary'],
        rejected: ['analytics'],
      });
      assert.equal(client.analytics.isEnabled(), false);
      assert.equal(client.getReplayId(), null);
      client.analytics.track('ignored');
      await client.analytics.flush();
      await Promise.resolve();
      assert.equal(
        urls.filter((url) => url.includes('/analytics/')).length,
        grantedPosts,
      );
      const replayPosts = urls.filter((url) => url.includes('/replays/')).length;
      await Promise.resolve();
      assert.equal(
        urls.filter((url) => url.includes('/replays/')).length,
        replayPosts,
      );
    } finally {
      await client.close();
      clearBannerGlobals();
    }
  });

  it('reads Cookiebot statistics', async () => {
    installFetch();
    const emitter = new Emitter();
    Object.assign(globalThis, { window: emitter, document: emitter });
    (globalThis as { Cookiebot?: unknown }).Cookiebot = {
      consent: { statistics: false },
      hasResponse: true,
      declined: true,
    };
    const denied = openClient();
    try {
      denied.applySdkConfig(measurementPolicy());
      assert.equal(denied.analytics.isEnabled(), false);
      assert.equal(denied.getReplayId(), null);
    } finally {
      await denied.close();
    }

    (globalThis as { Cookiebot?: unknown }).Cookiebot = {
      consent: { statistics: true },
      hasResponse: true,
    };
    const granted = openClient();
    try {
      granted.applySdkConfig(measurementPolicy());
      assert.equal(granted.analytics.isEnabled(), true);
      assert.equal(typeof granted.getReplayId(), 'string');
    } finally {
      await granted.close();
      clearBannerGlobals();
    }
  });

  it('applies a Cookiebot decision that arrives after replay has started', async () => {
    installFetch();
    const emitter = new Emitter();
    Object.assign(globalThis, { window: emitter, document: emitter });
    const client = openClient();
    try {
      client.applySdkConfig(measurementPolicy());
      assert.equal(typeof client.getReplayId(), 'string');
      (globalThis as { Cookiebot?: unknown }).Cookiebot = {
        consent: { statistics: false },
        hasResponse: true,
      };
      emitter.dispatch('CookiebotOnConsentReady');
      assert.equal(client.analytics.isEnabled(), false);
      assert.equal(client.getReplayId(), null);
    } finally {
      await client.close();
      clearBannerGlobals();
    }
  });

  it('reads analytics_storage already on the data layer, including a later update', async () => {
    installFetch();
    (globalThis as { dataLayer?: unknown[] }).dataLayer = [
      ['consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied' }],
    ];
    const client = openClient({ publicAnalytics: true });
    try {
      client.applySdkConfig(measurementPolicy());
      assert.equal(client.analytics.isEnabled(), false);
      assert.equal(client.getReplayId(), null);

      (globalThis as { dataLayer: { push: (...args: unknown[]) => unknown } }).dataLayer.push([
        'consent',
        'update',
        { analytics_storage: 'granted' },
      ]);
      assert.equal(client.analytics.isEnabled(), true);
      assert.equal(typeof client.getReplayId(), 'string');
    } finally {
      await client.close();
      clearBannerGlobals();
    }
  });
});
