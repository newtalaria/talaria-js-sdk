import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { formatTraceparent, getCurrentSpanContext, RecordingSpan, type Span } from '@newtalaria/core';
import type { NodeTracer } from './tracer.js';

/** Cap for a JSON body scanned for `model` and `usage`. The text is discarded. */
export const MODEL_BODY_CAP_BYTES = 1_048_576;

const bypass = new AsyncLocalStorage<true>();

export function isModelFetchBypass(): boolean {
  return bypass.getStore() === true;
}

export interface ModelEndpoint {
  provider: 'openai' | 'anthropic';
  operation: string;
  host: string;
}

export interface ModelErrorStamp {
  model?: string;
  operation: string;
  provider: string;
  statusCode?: number;
}

export const MODEL_ERROR = Symbol.for('talaria.gen_ai');

export interface ModelFetchHooks {
  tracer: NodeTracer;
  addBreadcrumb?: (crumb: {
    type?: string;
    category?: string;
    message?: string;
    level?: string;
    data?: Record<string, string>;
  }) => void;
}

let boundHooks: ModelFetchHooks | null = null;

export function bindModelFetchHooks(hooks: ModelFetchHooks): void {
  boundHooks = hooks;
}

const OPENAI_OPERATIONS: Record<string, string> = {
  '/v1/chat/completions': 'chat',
  '/v1/responses': 'chat',
  '/v1/completions': 'text_completion',
  '/v1/embeddings': 'embeddings',
};

/**
 * Known chat, completion, and embedding endpoints only.
 * Any other path on these hosts stays a normal HTTP span.
 */
export function classifyModelUrl(rawUrl: string, method: string): ModelEndpoint | null {
  if (method.toUpperCase() !== 'POST') return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (host === 'api.openai.com') {
    const operation = OPENAI_OPERATIONS[path];
    if (!operation) return null;
    return { provider: 'openai', operation, host };
  }
  if (host === 'api.anthropic.com') {
    if (path !== '/v1/messages') return null;
    return { provider: 'anthropic', operation: 'chat', host };
  }
  return null;
}

export function readModelErrorStamp(error: unknown): ModelErrorStamp | undefined {
  const direct = stampOn(error);
  if (direct) return direct;
  if (error && typeof error === 'object' && 'cause' in error) {
    return stampOn((error as { cause?: unknown }).cause);
  }
  return undefined;
}

export function stampModelError(error: unknown, stamp: ModelErrorStamp): void {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return;
  try {
    Object.defineProperty(error, MODEL_ERROR, {
      value: stamp,
      enumerable: false,
      configurable: true,
    });
  } catch {
    // A frozen error still propagates; capture falls back to the classic fingerprint.
  }
}

type FetchInput = Parameters<typeof fetch>[0];

export function wrapModelFetch(fetchImpl: typeof fetch): typeof fetch {
  const wrapped = (async (input: FetchInput, init?: RequestInit) => {
    if (isModelFetchBypass()) return fetchImpl(input, init);
    const hooks = boundHooks;
    const url = fetchInputUrl(input);
    const method = requestMethod(input, init);
    const endpoint = classifyModelUrl(url, method);
    if (!endpoint || !hooks) return fetchImpl(input, init);
    return traceModelFetch(hooks, endpoint, input, init, (nextInput, nextInit) =>
      bypass.run(true, () => fetchImpl(nextInput, nextInit)),
    );
  }) as typeof fetch;
  return wrapped;
}

export async function traceModelFetch(
  hooks: ModelFetchHooks,
  endpoint: ModelEndpoint,
  input: FetchInput,
  init: RequestInit | undefined,
  send: (input: FetchInput, init?: RequestInit) => Promise<Response>,
): Promise<Response> {
  const prepared = await prepareRequest(input, init);
  const hints = prepared.hints;
  const span = openModelSpan(hooks, endpoint, hints.model);
  const headers = withTraceparent(prepared.input, prepared.init);
  try {
    const response = await send(prepared.input, { ...prepared.init, headers });
    const streaming =
      hints.stream ||
      (response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
    if (!streaming && response.status < 400) {
      await applyUsage(span, response);
    }
    finishHttpStatus(hooks, span, endpoint, hints.model, response.status);
    return response;
  } catch (error) {
    finishThrown(hooks, span, endpoint, hints.model, error);
    throw error;
  }
}

/**
 * One GenAI span for a Node `http`/`https` request to a known model endpoint.
 */
export function traceModelNodeRequest(
  hooks: ModelFetchHooks,
  endpoint: ModelEndpoint,
  req: ClientRequest,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let overCap = false;
  let hints: RequestHints = { stream: false };
  const span = openModelSpan(hooks, endpoint, undefined);

  const capture = (chunk: unknown, encoding?: BufferEncoding) => {
    if (overCap || chunk == null || typeof chunk === 'function') return;
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk, encoding)
        : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > MODEL_BODY_CAP_BYTES) {
      overCap = true;
      chunks.length = 0;
      return;
    }
    chunks.push(buf);
  };

  const applyRequest = () => {
    if (overCap || chunks.length === 0) return;
    hints = requestHints(parseJson(Buffer.concat(chunks).toString('utf8')));
    chunks.length = 0;
    if (hints.model) {
      renameSpan(span, modelSpanName(endpoint.operation, hints.model));
      span?.setAttribute('gen_ai.request.model', hints.model);
    }
  };

  const originalWrite = req.write.bind(req);
  const originalEnd = req.end.bind(req);
  req.write = ((
    chunk: unknown,
    encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
    cb?: (error: Error | null | undefined) => void,
  ) => {
    const enc = typeof encoding === 'string' ? encoding : undefined;
    capture(chunk, enc);
    if (typeof encoding === 'function') return originalWrite(chunk, encoding);
    return originalWrite(chunk, encoding as BufferEncoding, cb);
  }) as typeof req.write;
  req.end = ((
    chunk?: unknown,
    encoding?: BufferEncoding | (() => void),
    cb?: () => void,
  ) => {
    if (chunk != null && typeof chunk !== 'function') {
      capture(chunk, typeof encoding === 'string' ? encoding : undefined);
    }
    applyRequest();
    if (typeof chunk === 'function') return originalEnd(chunk);
    if (typeof encoding === 'function') return originalEnd(chunk as never, encoding);
    return originalEnd(chunk as never, encoding as BufferEncoding, cb);
  }) as typeof req.end;

  let finished = false;
  const finish = (status: number | undefined, thrown?: unknown) => {
    if (finished) return;
    finished = true;
    if (thrown) {
      finishThrown(hooks, span, endpoint, hints.model, thrown, status);
      return;
    }
    finishHttpStatus(hooks, span, endpoint, hints.model, status);
  };

  req.on('response', (res: IncomingMessage) => {
    const status = res.statusCode ?? 0;
    const streaming =
      hints.stream ||
      String(res.headers['content-type'] ?? '').toLowerCase().includes('text/event-stream');
    if (streaming || status >= 400 || !span) {
      res.on('end', () => finish(status));
      res.on('error', (error: Error) => finish(status, error));
      res.on('close', () => finish(status));
      return;
    }
    const body: Buffer[] = [];
    let total = 0;
    let dropped = false;
    const originalEmit = res.emit.bind(res);
    res.emit = ((event: string | symbol, ...args: unknown[]) => {
      if (!dropped && event === 'data' && args[0] != null) {
        const buf = Buffer.isBuffer(args[0]) ? args[0] : Buffer.from(args[0] as Uint8Array);
        total += buf.length;
        if (total > MODEL_BODY_CAP_BYTES) {
          dropped = true;
          body.length = 0;
        } else {
          body.push(buf);
        }
      }
      if (event === 'end') {
        if (!dropped && body.length > 0) {
          applyUsageJson(span, parseJson(Buffer.concat(body).toString('utf8')));
        }
        body.length = 0;
        finish(status);
      }
      return originalEmit(event, ...args);
    }) as typeof res.emit;
    res.on('error', (error: Error) => finish(status, error));
    res.on('close', () => finish(status));
  });
  req.on('error', (error: Error) => finish(undefined, error));
}

function openModelSpan(
  hooks: ModelFetchHooks,
  endpoint: ModelEndpoint,
  model: string | undefined,
): Span | null {
  return hooks.tracer.startSpan(modelSpanName(endpoint.operation, model), {
    kind: 'client',
    attributes: {
      'gen_ai.operation.name': endpoint.operation,
      'gen_ai.provider.name': endpoint.provider,
      'server.address': endpoint.host,
      'http.request.method': 'POST',
      ...(model ? { 'gen_ai.request.model': model } : {}),
    },
  });
}

function finishHttpStatus(
  hooks: ModelFetchHooks,
  span: Span | null,
  endpoint: ModelEndpoint,
  model: string | undefined,
  status: number | undefined,
): void {
  if (typeof status === 'number' && status > 0) {
    span?.setAttribute('http.response.status_code', status);
  }
  if (typeof status === 'number' && status >= 400) {
    const label = `HTTP ${status}`;
    span?.setStatus('error', label);
    span?.setAttribute('error.type', label);
    if (status >= 500) hooks.tracer.markError();
  } else {
    span?.setStatus('ok');
  }
  span?.end();
  addModelBreadcrumb(hooks, endpoint, model, status, typeof status === 'number' && status >= 400);
}

function finishThrown(
  hooks: ModelFetchHooks,
  span: Span | null,
  endpoint: ModelEndpoint,
  model: string | undefined,
  error: unknown,
  status?: number,
): void {
  const errorType = error instanceof Error && error.name ? error.name : 'Error';
  if (typeof status === 'number' && status > 0) {
    span?.setAttribute('http.response.status_code', status);
  }
  span?.setStatus('error', errorType);
  span?.setAttribute('error.type', errorType);
  hooks.tracer.markError();
  stampModelError(error, {
    model,
    operation: endpoint.operation,
    provider: endpoint.provider,
    ...(typeof status === 'number' && status > 0 ? { statusCode: status } : {}),
  });
  span?.end();
  addModelBreadcrumb(hooks, endpoint, model, status, true);
}

function addModelBreadcrumb(
  hooks: ModelFetchHooks,
  endpoint: ModelEndpoint,
  model: string | undefined,
  status: number | undefined,
  failed: boolean,
): void {
  const data: Record<string, string> = {
    'gen_ai.operation.name': endpoint.operation,
    'gen_ai.provider.name': endpoint.provider,
  };
  if (model) data['gen_ai.request.model'] = model;
  if (typeof status === 'number' && status > 0) {
    data['http.response.status_code'] = String(status);
  }
  hooks.addBreadcrumb?.({
    type: 'http',
    category: 'gen_ai',
    message: modelSpanName(endpoint.operation, model),
    level: failed ? 'error' : 'info',
    data,
  });
}

async function applyUsage(span: Span | null, response: Response): Promise<void> {
  if (!span) return;
  const length = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(length) && length > MODEL_BODY_CAP_BYTES) return;
  let clone: Response;
  try {
    clone = response.clone();
  } catch {
    return;
  }
  const text = await readCapped(clone.body, MODEL_BODY_CAP_BYTES);
  if (!text) return;
  applyUsageJson(span, parseJson(text));
}

function applyUsageJson(span: Span | null, parsed: unknown): void {
  if (!span || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const record = parsed as Record<string, unknown>;
  if (typeof record.model === 'string' && record.model.trim()) {
    span.setAttribute('gen_ai.response.model', record.model.trim().slice(0, 256));
  }
  const usage = record.usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return;
  const counts = usage as Record<string, unknown>;
  const input = tokenCount(counts.input_tokens, counts.prompt_tokens);
  const output = tokenCount(counts.output_tokens, counts.completion_tokens);
  if (input) span.setAttribute('gen_ai.usage.input_tokens', input);
  if (output) span.setAttribute('gen_ai.usage.output_tokens', output);
}

interface RequestHints {
  model?: string;
  stream: boolean;
}

async function prepareRequest(
  input: FetchInput,
  init?: RequestInit,
): Promise<{ input: FetchInput; init?: RequestInit; hints: RequestHints }> {
  const body = init?.body;
  if (typeof body === 'string') {
    return {
      input,
      init,
      hints: body.length > MODEL_BODY_CAP_BYTES ? { stream: false } : requestHints(parseJson(body)),
    };
  }
  if (body instanceof Uint8Array) {
    if (body.byteLength > MODEL_BODY_CAP_BYTES) return { input, init, hints: { stream: false } };
    return { input, init, hints: requestHints(parseJson(new TextDecoder().decode(body))) };
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    if (body.size > MODEL_BODY_CAP_BYTES) return { input, init, hints: { stream: false } };
    return { input, init, hints: requestHints(parseJson(await body.text())) };
  }
  if (body instanceof ReadableStream) {
    const [ours, theirs] = body.tee();
    const text = await readCapped(ours, MODEL_BODY_CAP_BYTES);
    return {
      input,
      init: { ...init, body: theirs },
      hints: requestHints(parseJson(text)),
    };
  }
  if (typeof Request !== 'undefined' && input instanceof Request && body == null) {
    try {
      const text = await readCapped(input.clone().body, MODEL_BODY_CAP_BYTES);
      return { input, init, hints: requestHints(parseJson(text)) };
    } catch {
      return { input, init, hints: { stream: false } };
    }
  }
  return { input, init, hints: { stream: false } };
}

function withTraceparent(input: FetchInput, init?: RequestInit): Headers {
  const headers = new Headers(
    init?.headers ??
      (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined),
  );
  const ctx = getCurrentSpanContext();
  if (ctx && !headers.has('traceparent')) {
    headers.set('traceparent', formatTraceparent(ctx));
  }
  return headers;
}

function requestHints(parsed: unknown): RequestHints {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { stream: false };
  const record = parsed as Record<string, unknown>;
  const model = typeof record.model === 'string' ? record.model.trim().slice(0, 256) : '';
  return { model: model || undefined, stream: record.stream === true };
}

function parseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function tokenCount(...candidates: unknown[]): string | undefined {
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return String(Math.trunc(value));
    }
  }
  return undefined;
}

function modelSpanName(operation: string, model: string | undefined): string {
  return model ? `${operation} ${model}` : operation;
}

function renameSpan(span: Span | null, name: string): void {
  if (span instanceof RecordingSpan) span.data.name = name;
}

function fetchInputUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: FetchInput, init?: RequestInit): string {
  return (
    init?.method ||
    (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
}

async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  cap: number,
): Promise<string | undefined> {
  if (!stream) return undefined;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > cap) {
        overflow = true;
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  } finally {
    if (!overflow) {
      try {
        reader.releaseLock();
      } catch {
        // cancel() already released the lock
      }
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function stampOn(error: unknown): ModelErrorStamp | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { [MODEL_ERROR]?: ModelErrorStamp })[MODEL_ERROR];
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.operation !== 'string' || typeof value.provider !== 'string') return undefined;
  return value;
}
