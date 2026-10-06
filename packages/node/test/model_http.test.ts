import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SdkConfigDocument } from '@newtalaria/core';
import { TalariaNodeClient } from '../src/client.ts';
import { classifyModelUrl } from '../src/model_http.ts';
import { installOutgoingHttpInstrumentation } from '../src/outgoing.ts';
import { wrapModelFetch } from '../src/index.ts';

const DSN = 'http://127.0.0.1:9';

interface SpanWire {
  name: string;
  kind: string;
  status?: string;
  statusMessage?: string;
  parentSpanId?: string;
  attributes?: Record<string, string>;
}

interface EventWire {
  message?: string;
  tags?: Record<string, string>;
  extraJson?: string;
  breadcrumbs?: Array<{ category?: string; message?: string; data?: Record<string, string> }>;
}

function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

describe('model URL classification', () => {
  it('maps known OpenAI and Anthropic paths and leaves other URLs alone', () => {
    assert.equal(classifyModelUrl('https://api.openai.com/v1/chat/completions', 'POST')?.operation, 'chat');
    assert.equal(classifyModelUrl('https://api.openai.com/v1/responses', 'POST')?.operation, 'chat');
    assert.equal(classifyModelUrl('https://api.openai.com/v1/completions', 'POST')?.operation, 'text_completion');
    assert.equal(classifyModelUrl('https://api.openai.com/v1/embeddings', 'POST')?.operation, 'embeddings');
    assert.equal(classifyModelUrl('https://api.anthropic.com/v1/messages', 'POST')?.operation, 'chat');
    assert.equal(classifyModelUrl('https://api.openai.com/v1/models', 'POST'), null);
    assert.equal(classifyModelUrl('https://example.test/v1/chat/completions', 'POST'), null);
    assert.equal(classifyModelUrl('https://api.openai.com/v1/chat/completions', 'GET'), null);
  });
});

describe('model HTTP spans', () => {
  const originalFetch = globalThis.fetch;

  async function withClient(
    sampleRate: number,
    run: (client: TalariaNodeClient, spans: () => SpanWire[], events: () => EventWire[]) => Promise<void>,
    respond?: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
  ): Promise<void> {
    const spanBatches: SpanWire[][] = [];
    const eventBatches: EventWire[][] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === 'string' ? init.body : '';
      if (url.includes('/spans/ingestBatch')) {
        const parsed = JSON.parse(body || '{}') as { input?: { spans?: SpanWire[] } };
        if (parsed.input?.spans) spanBatches.push(parsed.input.spans);
        return jsonResponse({});
      }
      if (url.includes('/events/')) {
        eventBatches.push(
          ((JSON.parse(body) as { input: { events: EventWire[] } }).input.events) ?? [],
        );
        return jsonResponse({});
      }
      if (respond) return respond(url, init);
      return jsonResponse({});
    }) as typeof fetch;

    const client = new TalariaNodeClient();
    try {
      client.init({
        dsn: DSN,
        apiKey: 'tal_live_test',
        remoteConfig: false,
        disableDefaultIntegrations: true,
      });
      installOutgoingHttpInstrumentation(client);
      client.applySdkConfig({
        schemaVersion: 1,
        revision: 'test',
        active: true,
        tracing: { enabled: true, tracesSampleRate: sampleRate },
      } as SdkConfigDocument);
      await run(
        client,
        () => spanBatches.flat(),
        () => eventBatches.flat(),
      );
    } finally {
      await client.close();
      globalThis.fetch = originalFetch;
    }
  }

  function modelSpans(spans: SpanWire[]): SpanWire[] {
    return spans.filter((span) => span.attributes?.['gen_ai.operation.name']);
  }

  it('records an OpenAI chat span with usage and without prompt text', async () => {
    await withClient(1, async (client, spans) => {
      const root = client.startTransaction('POST /checkout', { kind: 'server' });
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'SECRET_PROMPT' }],
        }),
      });
      const payload = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      assert.equal(payload.choices[0]?.message.content, 'SECRET_COMPLETION');
      root?.end();
      await client.flush();

      const model = modelSpans(spans());
      assert.equal(model.length, 1);
      const span = model[0]!;
      assert.equal(span.name, 'chat gpt-4o');
      assert.equal(span.kind, 'client');
      assert.ok(span.parentSpanId);
      assert.equal(span.status, 'ok');
      assert.equal(span.attributes?.['gen_ai.provider.name'], 'openai');
      assert.equal(span.attributes?.['gen_ai.request.model'], 'gpt-4o');
      assert.equal(span.attributes?.['gen_ai.response.model'], 'gpt-4o-2024-08-06');
      assert.equal(span.attributes?.['gen_ai.usage.input_tokens'], '11');
      assert.equal(span.attributes?.['gen_ai.usage.output_tokens'], '7');
      assert.equal(span.attributes?.['server.address'], 'api.openai.com');
      assert.equal(span.attributes?.['http.response.status_code'], '200');
      const encoded = JSON.stringify(span.attributes);
      assert.equal(encoded.includes('SECRET_PROMPT'), false);
      assert.equal(encoded.includes('SECRET_COMPLETION'), false);
    }, () =>
      jsonResponse({
        model: 'gpt-4o-2024-08-06',
        choices: [{ message: { content: 'SECRET_COMPLETION' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }),
    );
  });

  it('maps Anthropic and Responses API token fields', async () => {
    await withClient(1, async (client, spans) => {
      const root = client.startTransaction('POST /checkout', { kind: 'server' });
      await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [{ content: 'SECRET_PROMPT' }] }),
      });
      await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4.1', input: 'SECRET_PROMPT' }),
      });
      root?.end();
      await client.flush();
      const recorded = modelSpans(spans());
      const anthropic = recorded.find((span) => span.attributes?.['gen_ai.provider.name'] === 'anthropic');
      const responses = recorded.find((span) => span.name === 'chat gpt-4.1');
      assert.equal(anthropic?.name, 'chat claude-3-5-sonnet');
      assert.equal(anthropic?.attributes?.['gen_ai.usage.input_tokens'], '3');
      assert.equal(anthropic?.attributes?.['gen_ai.usage.output_tokens'], '4');
      assert.equal(responses?.attributes?.['gen_ai.usage.input_tokens'], '8');
      assert.equal(responses?.attributes?.['gen_ai.usage.output_tokens'], '2');
      assert.equal(JSON.stringify(recorded).includes('SECRET_PROMPT'), false);
    }, (url) => {
      if (url.includes('anthropic')) {
        return jsonResponse({
          model: 'claude-3-5-sonnet-20241022',
          content: [{ text: 'SECRET_COMPLETION' }],
          usage: { input_tokens: 3, output_tokens: 4 },
        });
      }
      return jsonResponse({
        model: 'gpt-4.1',
        output: [{ content: [{ text: 'SECRET_COMPLETION' }] }],
        usage: { input_tokens: 8, output_tokens: 2 },
      });
    });
  });

  it('omits tokens and stores no SSE text for a stream', async () => {
    await withClient(1, async (client, spans) => {
      const root = client.startTransaction('POST /checkout', { kind: 'server' });
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ content: 'SECRET_PROMPT' }] }),
      });
      const text = await response.text();
      assert.equal(text.includes('SECRET_COMPLETION'), true);
      root?.end();
      await client.flush();
      const span = modelSpans(spans())[0]!;
      assert.equal(span.name, 'chat gpt-4o');
      assert.equal(span.attributes?.['gen_ai.usage.input_tokens'], undefined);
      assert.equal(span.attributes?.['gen_ai.usage.output_tokens'], undefined);
      assert.equal(JSON.stringify(span).includes('SECRET'), false);
    }, () =>
      new Response('data: {"choices":[{"delta":{"content":"SECRET_COMPLETION"}}]}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
  });

  it('sets a 4xx span to error without forcing the sample', async () => {
    await withClient(0, async (client, spans) => {
      const root = client.startTransaction('POST /checkout', { kind: 'server' });
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ content: 'SECRET_PROMPT' }] }),
      });
      assert.equal(response.status, 400);
      root?.end();
      await client.flush();
      assert.equal(spans().length, 0);
    }, () => jsonResponse({ error: { message: 'SECRET_PROMPT rejected' } }, 400));

    await withClient(1, async (client, spans) => {
      const root = client.startTransaction('POST /checkout', { kind: 'server' });
      await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o' }),
      });
      root?.end();
      await client.flush();
      const span = modelSpans(spans())[0]!;
      assert.equal(span.status, 'error');
      assert.equal(span.statusMessage, 'HTTP 400');
      assert.equal(span.attributes?.['error.type'], 'HTTP 400');
      assert.equal(JSON.stringify(span).includes('SECRET'), false);
    }, () => jsonResponse({ error: { message: 'SECRET_PROMPT rejected' } }, 400));
  });

  it('keeps a 5xx transaction when the sample rate is zero', async () => {
    await withClient(0, async (client, spans) => {
      const root = client.startTransaction('POST /checkout', { kind: 'server' });
      await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o' }),
      });
      root?.end();
      await client.flush();
      const span = modelSpans(spans())[0]!;
      assert.equal(span.status, 'error');
      assert.equal(span.statusMessage, 'HTTP 500');
    }, () => jsonResponse({ error: { message: 'overloaded' } }, 500));
  });

  it('stamps a thrown call and captureException copies the model tag', async () => {
    await withClient(1, async (client, spans, events) => {
      const root = client.startTransaction('POST /checkout', { kind: 'server' });
      let caught: unknown;
      try {
        await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: 'gpt-4o', messages: [{ content: 'SECRET_PROMPT' }] }),
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof Error);
      assert.equal((caught as Error).message.includes('SECRET_PROMPT'), true);
      await client.captureException(caught);
      root?.end();
      await client.flush();

      const span = modelSpans(spans())[0]!;
      assert.equal(span.status, 'error');
      assert.equal(span.statusMessage, 'TypeError');
      assert.equal(span.attributes?.['error.type'], 'TypeError');
      assert.equal(JSON.stringify(span).includes('SECRET_PROMPT'), false);

      const event = events()[0]!;
      assert.equal(event.tags?.['gen_ai.request.model'], 'gpt-4o');
      assert.equal(event.tags?.['gen_ai.operation.name'], 'chat');
      assert.equal(event.tags?.['gen_ai.provider.name'], 'openai');
      const crumb = event.breadcrumbs?.find((item) => item.category === 'gen_ai');
      assert.equal(crumb?.message, 'chat gpt-4o');
      assert.equal(crumb?.data?.['gen_ai.request.model'], 'gpt-4o');
    }, () => {
      throw new TypeError('socket hang up SECRET_PROMPT');
    });
  });

  it('keeps a non-model URL on the HTTP span and skips ingest URLs', async () => {
    await withClient(1, async (client, spans) => {
      const root = client.startTransaction('POST /checkout', { kind: 'server' });
      await fetch('https://example.test/health');
      await fetch('https://api.openai.com/v1/models', { method: 'POST', body: '{}' });
      await fetch(`${DSN}/spans/ingestBatch`, { method: 'POST', body: '{}' });
      root?.end();
      await client.flush();
      const recorded = spans();
      assert.equal(modelSpans(recorded).length, 0);
      assert.ok(recorded.some((span) => span.name === 'GET /health'));
      assert.ok(recorded.some((span) => span.name === 'POST /v1/models'));
      assert.equal(
        recorded.some((span) => span.kind === 'client' && span.name.includes('ingestBatch')),
        false,
      );
    });
  });

  it('does not start a span when no transaction is open', async () => {
    await withClient(1, async (client, spans) => {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o' }),
      });
      assert.equal(response.status, 200);
      await client.flush();
      assert.equal(spans().length, 0);
    }, () => jsonResponse({ model: 'gpt-4o', usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });

  it('records one span when wrapModelFetch and the global patch both see the call', async () => {
    await withClient(1, async (client, spans) => {
      const root = client.startTransaction('POST /checkout', { kind: 'server' });
      const wrapped = wrapModelFetch(globalThis.fetch);
      await wrapped('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ content: 'SECRET_PROMPT' }] }),
      });
      root?.end();
      await client.flush();
      assert.equal(modelSpans(spans()).length, 1);
      assert.equal(modelSpans(spans())[0]?.name, 'chat gpt-4o');
    }, () =>
      jsonResponse({
        model: 'gpt-4o',
        choices: [{ message: { content: 'SECRET_COMPLETION' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
  });
});
