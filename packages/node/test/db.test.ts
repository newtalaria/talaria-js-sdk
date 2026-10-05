import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SdkConfigDocument } from '@newtalaria/core';
import { TalariaNodeClient } from '../src/client.ts';
import { wrapDuckDB } from '../src/db/duckdb.ts';
import { wrapRedis } from '../src/db/redis.ts';

const tracingOn: SdkConfigDocument = {
  schemaVersion: 1,
  revision: 'test',
  active: true,
  ttlSeconds: 300,
  events: { sampleRate: 1 },
  tracing: { enabled: true, tracesSampleRate: 1 },
  analytics: { enabled: false },
  flags: { enabled: false },
};

function client(): TalariaNodeClient {
  const subject = new TalariaNodeClient();
  subject.init({
    dsn: 'http://localhost:8080',
    apiKey: 'tal_live_test',
    disableDefaultIntegrations: true,
    remoteConfig: false,
  });
  subject.applySdkConfig(tracingOn);
  subject.startTransaction('request');
  return subject;
}

async function collected(subject: TalariaNodeClient): Promise<{
  spans: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}> {
  const spans: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as { input?: Record<string, unknown> };
    const inputBody = body.input ?? {};
    if (url.includes('/spans/')) {
      spans.push(...((inputBody.spans as Array<Record<string, unknown>>) ?? []));
    }
    if (url.includes('/events/')) {
      events.push(...((inputBody.events as Array<Record<string, unknown>>) ?? []));
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    await subject.close();
  } finally {
    globalThis.fetch = original;
  }
  return { spans, events };
}

function attrs(span: Record<string, unknown>): Record<string, string> {
  return (span.attributes as Record<string, string>) ?? {};
}

describe('wrapDuckDB', () => {
  it('records a client span with the verb and sanitized SQL', async () => {
    const subject = client();
    const connection = {
      async runAndReadAll(sql: string, params: unknown) {
        assert.equal(sql, "FROM events SELECT count(*) WHERE region = 'us-west' AND n = 42");
        assert.deepEqual(params, { token: 'row-secret' });
        return { rows: [{ token: 'row-secret' }] };
      },
    };
    const wrapped = wrapDuckDB(subject, connection);
    await wrapped.runAndReadAll("FROM events SELECT count(*) WHERE region = 'us-west' AND n = 42", {
      token: 'row-secret',
    });

    const { spans } = await collected(subject);
    const query = spans.find((span) => attrs(span)['db.system.name'] === 'duckdb');
    assert.ok(query);
    assert.equal(query.kind, 'client');
    assert.equal(query.name, 'SELECT events');
    assert.equal(attrs(query)['db.operation.name'], 'SELECT');
    assert.equal(
      attrs(query)['db.query.text'],
      'FROM events SELECT count(*) WHERE region = ? AND n = ?',
    );
    const encoded = JSON.stringify(spans);
    assert.equal(encoded.includes('row-secret'), false);
    assert.equal(encoded.includes('us-west'), false);
  });

  it('captures the exception with sanitized SQL and still rejects', async () => {
    const subject = client();
    const connection = {
      async run(_sql: string, params: unknown) {
        assert.deepEqual(params, { token: 'row-secret' });
        throw new Error('Transaction conflict');
      },
    };
    const wrapped = wrapDuckDB(subject, connection);
    await assert.rejects(
      () => wrapped.run("SELECT name FROM users WHERE region = 'us-west'", { token: 'row-secret' }),
      /Transaction conflict/,
    );

    const { spans, events } = await collected(subject);
    const query = spans.find((span) => attrs(span)['db.system.name'] === 'duckdb');
    assert.ok(query);
    assert.equal(query.status, 'error');
    assert.equal(attrs(query)['db.query.text'], 'SELECT name FROM users WHERE region = ?');
    assert.equal(events.length > 0, true);
    const extra = JSON.parse(String(events[0]!.extraJson)) as Record<string, string>;
    assert.equal(extra['db.system.name'], 'duckdb');
    assert.equal(extra['db.query.text'], 'SELECT name FROM users WHERE region = ?');
    assert.equal(JSON.stringify(events).includes('row-secret'), false);
    assert.equal(JSON.stringify(events).includes('us-west'), false);
    assert.match(String(events[0]!.message), /Transaction conflict/);
  });

  it('writes a breadcrumb and no span when query spans are off', async () => {
    const subject = client();
    subject.setRecordQuerySpans(false);
    const crumbs: Array<{ category?: string; message?: string }> = [];
    const original = subject.addBreadcrumb.bind(subject);
    subject.addBreadcrumb = (crumb) => {
      crumbs.push(crumb);
      original(crumb);
    };
    const connection = {
      async run() {
        return { rows: [{ token: 'row-secret' }] };
      },
    };
    await wrapDuckDB(subject, connection).run('SELECT name FROM users');

    const { spans } = await collected(subject);
    assert.equal(
      spans.some((span) => attrs(span)['db.system.name'] === 'duckdb'),
      false,
    );
    assert.equal(
      crumbs.some((crumb) => crumb.category === 'db' && crumb.message === 'SELECT'),
      true,
    );
  });

  it('uses the prepared SQL for a later run', async () => {
    const subject = client();
    const statement = {
      async run() {
        return { rows: [{ token: 'row-secret' }] };
      },
    };
    const connection = {
      async prepare(sql: string) {
        assert.match(sql, /SELECT name FROM users/);
        return statement;
      },
    };
    const wrapped = wrapDuckDB(subject, connection);
    const prepared = await wrapped.prepare('SELECT name FROM users WHERE id = 7');
    await prepared.run();

    const { spans } = await collected(subject);
    const query = spans.find((span) => attrs(span)['db.query.text']?.includes('SELECT name FROM users'));
    assert.ok(query);
    assert.equal(attrs(query)['db.query.text'], 'SELECT name FROM users WHERE id = ?');
    assert.equal(attrs(query)['db.query.count'], '2');
    assert.equal(JSON.stringify(spans).includes('row-secret'), false);
    assert.equal(
      spans.some((span) => span.name === 'db duckdb'),
      false,
    );
  });

  it('keeps the start span open until the pending result is read', async () => {
    const subject = client();
    let release: (value: unknown) => void = () => {};
    const pending = {
      getResult: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const connection = {
      async start() {
        return pending;
      },
    };
    const started = await wrapDuckDB(subject, connection).start('SELECT name FROM users');
    const reading = started.getResult();

    const early = await flushOnly(subject);
    assert.equal(
      early.some((span) => attrs(span)['db.system.name'] === 'duckdb'),
      false,
    );

    release({ rows: [{ token: 'row-secret' }] });
    await reading;
    const { spans } = await collected(subject);
    const query = spans.find((span) => attrs(span)['db.system.name'] === 'duckdb');
    assert.ok(query);
    assert.equal(attrs(query)['db.query.text'], 'SELECT name FROM users');
    assert.equal(JSON.stringify(spans).includes('row-secret'), false);
  });
});

describe('wrapRedis', () => {
  it('names the span from an argument array and from a Command name', async () => {
    const subject = client();
    const redis = wrapRedis(subject, {
      async sendCommand() {
        return 'ok';
      },
    });
    await redis.sendCommand(['GET', 'session-secret']);
    await redis.sendCommand({ name: 'SET' });

    const { spans } = await collected(subject);
    const names = spans.map((span) => span.name);
    assert.ok(names.includes('db redis GET'));
    assert.ok(names.includes('db redis SET'));
    assert.equal(JSON.stringify(spans).includes('session-secret'), false);
  });
});

async function flushOnly(subject: TalariaNodeClient): Promise<Array<Record<string, unknown>>> {
  const spans: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as { input?: Record<string, unknown> };
    if (url.includes('/spans/')) {
      spans.push(...(((body.input ?? {}).spans as Array<Record<string, unknown>>) ?? []));
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    await subject.flush();
  } finally {
    globalThis.fetch = original;
  }
  return spans;
}
