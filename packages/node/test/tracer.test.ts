import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServerpodTransport } from '@newtalaria/core';
import { NodeTracer } from '../src/tracer.ts';

function tracer(): NodeTracer {
  return new NodeTracer({
    transport: new ServerpodTransport({
      baseUrl: 'http://localhost:8080',
      apiKey: 'tal_live_test',
    }),
    sampleRate: 1,
    resource: { 'service.name': 'test' },
    environment: 'test',
    getUserId: () => undefined,
    getSessionId: () => null,
    getAnonymousId: () => null,
  });
}

async function sentSpans(run: (subject: NodeTracer) => Promise<void> | void) {
  const subject = tracer();
  await run(subject);
  return flush(subject);
}

async function flush(subject: NodeTracer) {
  const bodies: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await subject.shutdown();
    return bodies.flatMap((body) => {
      const input = body.input as Record<string, unknown>;
      return (input.spans as Array<Record<string, unknown>>) ?? [];
    });
  } finally {
    globalThis.fetch = original;
  }
}

describe('NodeTracer SQL budget', () => {
  it('rolls interleaved SQL up under one parent and keeps later phases', async () => {
    const spans = await sentSpans((subject) => {
      const root = subject.startTransaction('task');
      const products = subject.startSpan('shopify.import_products', { parent: root.context })!;
      for (let i = 0; i < 12; i++) {
        for (const text of ['SELECT File', 'SELECT SiteTree', 'SELECT Shopify_ProductVariant']) {
          subject
            .startSpan(text, {
              kind: 'client',
              parent: products.context,
              attributes: { 'db.query.text': text },
            })!
            .end();
        }
      }
      products.end();
      subject.startSpan('shopify.import_collections', { parent: root.context })!.end();
      subject.startSpan('shopify.import_collects', { parent: root.context })!.end();
    });

    const names = spans.map((span) => span.name);
    assert.equal(names.filter((name) => name === 'SELECT File').length, 1);
    assert.ok(names.includes('shopify.import_collections'));
    assert.ok(names.includes('shopify.import_collects'));
    const file = spans.find((span) => span.name === 'SELECT File')!;
    assert.equal((file.attributes as Record<string, string>)['db.query.count'], '12');
    const root = spans.find((span) => span.name === 'task')!;
    assert.equal(
      (root.attributes as Record<string, string> | undefined)?.['dropped_span_count'],
      undefined,
    );
  });

  it('keeps a slow query and a failed query out of the fast group', async () => {
    const spans = await sentSpans((subject) => {
      const root = subject.startTransaction('task');
      subject
        .startSpan('SELECT File', {
          kind: 'client',
          parent: root.context,
          attributes: { 'db.query.text': 'SELECT File' },
        })!
        .end();
      subject
        .startSpan('SELECT File', {
          kind: 'client',
          parent: root.context,
          attributes: { 'db.query.text': 'SELECT File' },
        })!
        .end();
      subject
        .startSpan('SELECT File', {
          kind: 'client',
          parent: root.context,
          attributes: { 'db.query.text': 'SELECT File' },
          startTime: new Date(Date.now() - 250),
        })!
        .end();
      const failed = subject.startSpan('SELECT File', {
        kind: 'client',
        parent: root.context,
        attributes: { 'db.query.text': 'SELECT File' },
      })!;
      failed.setStatus('error', 'deadlock');
      failed.end();
    });

    const queries = spans.filter((span) => span.name === 'SELECT File');
    assert.equal(queries.length, 3);
    const rolled = queries.find(
      (span) => (span.attributes as Record<string, string>)['db.query.count'] === '2',
    );
    assert.ok(rolled);
  });

  it('drops the 169th distinct statement and still stores a later phase', async () => {
    const spans = await sentSpans((subject) => {
      const root = subject.startTransaction('task');
      for (let i = 0; i < 169; i++) {
        subject
          .startSpan(`SELECT t${i}`, {
            kind: 'client',
            parent: root.context,
            attributes: { 'db.query.text': `SELECT t${i}` },
          })!
          .end();
      }
      subject.startSpan('shopify.import_collections', { parent: root.context })!.end();
    });

    const names = spans.map((span) => span.name);
    assert.equal(names.includes('SELECT t168'), false);
    assert.ok(names.includes('SELECT t167'));
    assert.ok(names.includes('shopify.import_collections'));
    const root = spans.find((span) => span.name === 'task')!;
    assert.equal((root.attributes as Record<string, string>)['dropped_span_count'], '1');
  });

  it('restores query recording when withoutQuerySpans throws', async () => {
    const subject = tracer();
    subject.startTransaction('task');
    await assert.rejects(
      () =>
        subject.withoutQuerySpans(() => {
          subject.startSpan('shopify.import_collections')!.end();
          subject
            .startSpan('SELECT File', {
              kind: 'client',
              attributes: { 'db.query.text': 'SELECT File' },
            })!
            .end();
          throw new Error('boom');
        }),
      /boom/,
    );
    assert.equal(subject.recordsQuerySpans, true);
    const spans = await flush(subject);
    assert.deepEqual(
      spans.map((span) => span.name).sort(),
      ['shopify.import_collections', 'task'],
    );
  });
});
