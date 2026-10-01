import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AnalyticsFacade,
  FEATURE_FLAG_CALLED,
  IdentityStore,
  ServerpodTransport,
  TalariaFlags,
  createMemoryStorage,
  evaluateFlags,
  flagEvaluationFromWire,
} from '../src/index.ts';

function evaluateResponse(args: {
  key: string;
  variationKey: string;
  value: unknown;
  version?: number;
  reason?: string;
}): Record<string, unknown> {
  return {
    evaluations: [
      {
        key: args.key,
        variationKey: args.variationKey,
        valueJson: JSON.stringify(args.value),
        version: args.version ?? 1,
        ...(args.reason ? { reason: args.reason } : {}),
      },
    ],
  };
}

function installFetch(
  handler: (url: string, body: Record<string, unknown>) => Record<string, unknown>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const payload = handler(url, body);
    return new Response(JSON.stringify({ data: payload }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe('feature flags client', () => {
  it('skips network and returns defaults when flags are disabled', async () => {
    let called = false;
    const restore = installFetch(() => {
      called = true;
      return evaluateResponse({ key: 'demo', variationKey: 'on', value: true });
    });
    try {
      const storage = createMemoryStorage();
      const identity = new IdentityStore(storage, { initialAnonymousId: 'anon-1' });
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      const flags = new TalariaFlags({
        apiKey: 'tal_live_test',
        identity,
        storage,
        getTransport: () => transport,
        isEnabled: () => false,
        getUserId: () => undefined,
      });

      assert.equal(await flags.boolVariation('demo', false), false);
      assert.equal(called, false);
      flags.close();
    } finally {
      restore();
    }
  });

  it('boolVariation uses evaluate result and stampTags', async () => {
    const restore = installFetch((_url, body) => {
      const input = body.input as Record<string, unknown>;
      assert.equal(input.__className__, 'EvaluateFlagsInput');
      assert.equal(input.anonymousId, 'anon-1');
      return evaluateResponse({
        key: 'demo-kill-switch',
        variationKey: 'on',
        value: true,
      });
    });
    try {
      const storage = createMemoryStorage();
      const identity = new IdentityStore(storage, { initialAnonymousId: 'anon-1' });
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      const flags = new TalariaFlags({
        apiKey: 'tal_live_test',
        identity,
        storage,
        getTransport: () => transport,
        isEnabled: () => true,
        getUserId: () => undefined,
      });

      await flags.reload();
      assert.equal(await flags.boolVariation('demo-kill-switch', false), true);
      assert.equal(flags.activeFlags['demo-kill-switch'], 'on');
      assert.equal(flags.stampTags()['flag.demo-kill-switch'], 'on');
      flags.close();
    } finally {
      restore();
    }
  });

  it('string and json variations decode valueJson', async () => {
    const restore = installFetch(() => ({
      evaluations: [
        {
          key: 'copy',
          variationKey: 'b',
          valueJson: JSON.stringify('welcome'),
          version: 2,
        },
        {
          key: 'remote',
          variationKey: 'cfg',
          valueJson: JSON.stringify({ theme: 'dark' }),
          version: 3,
        },
      ],
    }));
    try {
      const storage = createMemoryStorage();
      const identity = new IdentityStore(storage, { initialAnonymousId: 'anon-1' });
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      const flags = new TalariaFlags({
        apiKey: 'tal_live_test',
        identity,
        storage,
        getTransport: () => transport,
        isEnabled: () => true,
        getUserId: () => undefined,
      });
      await flags.reload();
      assert.equal(await flags.stringVariation('copy', 'control'), 'welcome');
      assert.deepEqual(await flags.jsonVariation('remote', { theme: 'light' }), {
        theme: 'dark',
      });
      assert.equal(await flags.stringVariation('missing', 'fallback'), 'fallback');
      flags.close();
    } finally {
      restore();
    }
  });

  it('disk cache serves last evaluation for matching context', async () => {
    let calls = 0;
    const restore = installFetch(() => {
      calls += 1;
      return evaluateResponse({ key: 'demo', variationKey: 'on', value: true });
    });
    try {
      const storage = createMemoryStorage();
      const identity = new IdentityStore(storage, { initialAnonymousId: 'anon-1' });
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      const flags1 = new TalariaFlags({
        apiKey: 'tal_live_test',
        identity,
        storage,
        getTransport: () => transport,
        isEnabled: () => true,
        getUserId: () => undefined,
      });
      await flags1.reload();
      assert.equal(await flags1.boolVariation('demo', false), true);
      assert.equal(calls, 1);
      flags1.close();

      // Hang evaluate so the second client must use the cache.
      globalThis.fetch = (async () =>
        new Promise(() => {
          /* never resolves */
        })) as typeof fetch;

      const flags2 = new TalariaFlags({
        apiKey: 'tal_live_test',
        identity: new IdentityStore(storage, { initialAnonymousId: 'anon-1' }),
        storage,
        getTransport: () => transport,
        isEnabled: () => true,
        getUserId: () => undefined,
        startTimeoutMs: 20,
      });
      assert.equal(await flags2.boolVariation('demo', false), true);
      flags2.close();
    } finally {
      restore();
    }
  });

  it('start timeout returns default when evaluate is slow', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      await new Promise((r) => setTimeout(r, 200));
      return new Response(
        JSON.stringify({
          data: evaluateResponse({ key: 'slow', variationKey: 'on', value: true }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const storage = createMemoryStorage();
      const identity = new IdentityStore(storage, { initialAnonymousId: 'anon-1' });
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      const flags = new TalariaFlags({
        apiKey: 'tal_live_test',
        identity,
        storage,
        getTransport: () => transport,
        isEnabled: () => true,
        getUserId: () => undefined,
        startTimeoutMs: 20,
      });
      const value = await flags.boolVariation('slow', false);
      assert.equal(value, false);
      flags.close();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('posts EvaluateFlagsInput envelope', async () => {
    let url = '';
    let body: Record<string, unknown> | null = null;
    const restore = installFetch((u, b) => {
      url = u;
      body = b;
      return evaluateResponse({ key: 'demo', variationKey: 'on', value: true });
    });
    try {
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      const result = await evaluateFlags(transport, {
        anonymousId: 'anon_1',
        userId: 'user_1',
        attributes: { plan: 'team' },
      });
      assert.equal(url, 'http://localhost:8080/flags/evaluate');
      const input = body!.input as Record<string, unknown>;
      assert.equal(input.__className__, 'EvaluateFlagsInput');
      assert.equal(input.anonymousId, 'anon_1');
      assert.equal((input.attributes as Record<string, string>).plan, 'team');
      assert.equal((result.evaluations as Array<Record<string, unknown>>)[0]!.key, 'demo');
    } finally {
      restore();
    }
  });

  it('emits $feature_flag_called once per key per session', async () => {
    const restore = installFetch((url) => {
      if (url.includes('/flags/evaluate')) {
        return evaluateResponse({ key: 'demo', variationKey: 'on', value: true });
      }
      return {};
    });
    try {
      const storage = createMemoryStorage();
      const identity = new IdentityStore(storage, { initialAnonymousId: 'anon-1' });
      identity.touchSession();
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      const names: string[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        if (url.includes('/analytics/ingestBatch')) {
          const inputBody = body.input as Record<string, unknown>;
          const events = inputBody.events as Array<Record<string, unknown>>;
          for (const event of events) names.push(String(event.name));
        }
        if (url.includes('/flags/evaluate')) {
          return new Response(
            JSON.stringify({
              data: evaluateResponse({ key: 'demo', variationKey: 'on', value: true }),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;

      const analytics = new AnalyticsFacade({
        getTransport: () => transport,
        getIdentity: () => identity,
        getUserId: () => undefined,
        setUser: () => undefined,
        getReplayId: () => null,
        getTraceId: () => null,
        getSpanId: () => null,
        getPlatform: () => 'javascript',
        getRelease: () => undefined,
        getPageContext: () => ({}),
        mapScreenToPage: true,
        logLabel: 'test',
        onPermanentError: () => undefined,
      });
      analytics.optIn();

      const flags = new TalariaFlags({
        apiKey: 'tal_live_test',
        identity,
        storage,
        getTransport: () => transport,
        isEnabled: () => true,
        getUserId: () => undefined,
        analytics,
      });
      await flags.reload();
      await flags.boolVariation('demo', false);
      await flags.boolVariation('demo', false);
      await analytics.flush();
      assert.equal(names.filter((n) => n === FEATURE_FLAG_CALLED).length, 1);
      flags.close();
      globalThis.fetch = originalFetch;
    } finally {
      restore();
    }
  });

  it('flagEvaluationFromWire decodes valueJson', () => {
    const result = flagEvaluationFromWire({
      key: 'x',
      variationKey: 'on',
      valueJson: 'true',
      version: 2,
      reason: 'rule',
    });
    assert.equal(result.key, 'x');
    assert.equal(result.value, true);
    assert.equal(result.version, 2);
    assert.equal(result.reason, 'rule');
  });

  it('caps stampTags at 20', async () => {
    const evaluations = Array.from({ length: 25 }, (_, i) => ({
      key: `f${i}`,
      variationKey: `v${i}`,
      valueJson: 'true',
      version: 1,
    }));
    const restore = installFetch(() => ({ evaluations }));
    try {
      const storage = createMemoryStorage();
      const identity = new IdentityStore(storage, { initialAnonymousId: 'anon-1' });
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      const flags = new TalariaFlags({
        apiKey: 'tal_live_test',
        identity,
        storage,
        getTransport: () => transport,
        isEnabled: () => true,
        getUserId: () => undefined,
      });
      await flags.reload();
      assert.equal(Object.keys(flags.stampTags()).length, 20);
      flags.close();
    } finally {
      restore();
    }
  });
});
