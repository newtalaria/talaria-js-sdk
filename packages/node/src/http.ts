import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, RequestOptions, ServerResponse } from 'node:http';
import {
  extractTraceparent,
  formatTraceparent,
  getCurrentSpanContext,
  toSpanContext,
} from '@newtalaria/core';
import type { NodeTracer } from './tracer.js';

export interface HttpInstrumentOptions {
  tracer: NodeTracer;
  talariaBaseUrl?: string;
  ignoreUrls?: string[];
}

function isIgnored(rawUrl: string, opts: HttpInstrumentOptions): boolean {
  const base = opts.talariaBaseUrl?.replace(/\/+$/, '');
  if (base && rawUrl.startsWith(base)) return true;
  return (opts.ignoreUrls ?? []).some((part) => rawUrl.includes(part));
}

function requestUrl(options: RequestOptions | string | URL, protocol: string): string {
  if (typeof options === 'string') return options;
  if (options instanceof URL) return options.toString();
  const host = options.hostname || options.host || 'localhost';
  const port = options.port ? `:${options.port}` : '';
  const path = options.path || '/';
  return `${protocol}//${host}${port}${path}`;
}

type RequestArg = RequestOptions | string | URL | ((res: IncomingMessage) => void);

function callArgs(
  urlOrOpts: RequestOptions | string | URL,
  cbOrOpts?: RequestOptions | ((res: IncomingMessage) => void),
  maybeCb?: (res: IncomingMessage) => void,
): { options: RequestOptions; args: RequestArg[] } {
  if (typeof urlOrOpts === 'string' || urlOrOpts instanceof URL) {
    if (typeof cbOrOpts === 'function') {
      const options: RequestOptions = {};
      return { options, args: [urlOrOpts, options, cbOrOpts] };
    }
    const options = cbOrOpts ?? {};
    return maybeCb
      ? { options, args: [urlOrOpts, options, maybeCb] }
      : { options, args: [urlOrOpts, options] };
  }
  return maybeCb
    ? { options: urlOrOpts, args: [urlOrOpts, cbOrOpts as RequestOptions, maybeCb] }
    : cbOrOpts
      ? { options: urlOrOpts, args: [urlOrOpts, cbOrOpts as (res: IncomingMessage) => void] }
      : { options: urlOrOpts, args: [urlOrOpts] };
}

function patchOutgoing(
  mod: typeof http | typeof https,
  protocol: string,
  opts: HttpInstrumentOptions,
): () => void {
  const original = mod.request;
  const patched = function (
    this: unknown,
    urlOrOpts: RequestOptions | string | URL,
    cbOrOpts?: RequestOptions | ((res: IncomingMessage) => void),
    maybeCb?: (res: IncomingMessage) => void,
  ) {
    const { options, args } = callArgs(urlOrOpts, cbOrOpts, maybeCb);
    const url = requestUrl(
      typeof urlOrOpts === 'string' || urlOrOpts instanceof URL ? urlOrOpts : options,
      protocol,
    );
    if (isIgnored(url, opts)) {
      return original.apply(this, arguments as unknown as Parameters<typeof original>);
    }

    const ctx = getCurrentSpanContext();
    if (ctx) {
      const headers = { ...(options.headers ?? {}) } as Record<string, string | string[] | undefined>;
      headers.traceparent = formatTraceparent(ctx);
      options.headers = headers;
    }

    const method = (
      (typeof options === 'object' && options.method) ||
      'GET'
    ).toUpperCase();
    const span = opts.tracer.startSpan(`${method} ${new URL(url, 'http://localhost').pathname}`, {
      kind: 'client',
      attributes: {
        'http.request.method': method,
        'url.full': url,
      },
    });
    const req = original.apply(this, args as unknown as Parameters<typeof original>);
    req.on('response', (res: IncomingMessage) => {
      if (typeof res.statusCode === 'number') {
        span?.setAttribute('http.response.status_code', res.statusCode);
        if (res.statusCode >= 500) {
          span?.setStatus('error', `HTTP ${res.statusCode}`);
          opts.tracer.markError();
        } else {
          span?.setStatus('ok');
        }
      }
      span?.end();
    });
    req.on('error', (error) => {
      span?.setStatus('error', error.message);
      opts.tracer.markError();
      span?.end();
    });
    return req;
  };
  (mod as { request: typeof original }).request = patched as typeof original;
  const originalGet = mod.get;
  const patchedGet = function (
    this: unknown,
    ...args: Parameters<typeof originalGet>
  ) {
    const req = patched.apply(this, args);
    req.end();
    return req;
  };
  mod.get = patchedGet as typeof originalGet;
  return () => {
    (mod as { request: typeof original }).request = original;
    mod.get = originalGet;
  };
}

/**
 * Wrap a Node HTTP server request as a SERVER transaction.
 * Extracts inbound `traceparent` when present.
 */
export function continueTraceFromRequest(
  req: IncomingMessage,
  tracer: NodeTracer,
): ReturnType<NodeTracer['startTransaction']> {
  const parent = extractTraceparent(req.headers as Record<string, string>);
  const url = req.url || '/';
  const method = (req.method || 'GET').toUpperCase();
  const path = url.split('?')[0] || '/';
  return tracer.startTransaction(`${method} ${path}`, {
    kind: 'server',
    parent: parent ? toSpanContext(parent) : null,
    attributes: {
      'http.request.method': method,
      'url.path': path,
    },
  });
}

export function instrumentOutgoingHttp(opts: HttpInstrumentOptions): () => void {
  const undoHttp = patchOutgoing(http, 'http:', opts);
  const undoHttps = patchOutgoing(https, 'https:', opts);
  return () => {
    undoHttp();
    undoHttps();
  };
}

type FetchInput = Parameters<typeof fetch>[0];

function fetchInputUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Continue the active trace across global `fetch` (Next.js server calls). */
export function instrumentOutgoingFetch(opts: HttpInstrumentOptions): () => void {
  const original = globalThis.fetch;
  const patched = (async (input: FetchInput, init?: RequestInit) => {
    const url = fetchInputUrl(input);
    if (isIgnored(url, opts)) return original.call(globalThis, input, init);
    const ctx = getCurrentSpanContext();
    const method = (
      init?.method ||
      (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    let path = '/';
    try {
      path = new URL(url, 'http://localhost').pathname;
    } catch {
      path = '/';
    }
    const span = opts.tracer.startSpan(`${method} ${path}`, {
      kind: 'client',
      attributes: {
        'http.request.method': method,
        'url.full': url,
      },
    });
    const headers = new Headers(
      init?.headers ??
        (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined),
    );
    if (ctx && !headers.has('traceparent')) {
      headers.set('traceparent', formatTraceparent(ctx));
    }
    try {
      const response = await original.call(globalThis, input, { ...init, headers });
      span?.setAttribute('http.response.status_code', response.status);
      if (response.status >= 500) {
        span?.setStatus('error', `HTTP ${response.status}`);
        opts.tracer.markError();
      } else {
        span?.setStatus('ok');
      }
      span?.end();
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span?.setStatus('error', message);
      opts.tracer.markError();
      span?.end();
      throw error;
    }
  }) as typeof fetch;
  globalThis.fetch = patched;
  return () => {
    globalThis.fetch = original;
  };
}

export function attachRequestListener(
  req: IncomingMessage,
  res: ServerResponse,
  tracer: NodeTracer,
): void {
  const span = continueTraceFromRequest(req, tracer);
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      span.setStatus('error', `HTTP ${res.statusCode}`);
      tracer.markError();
    } else {
      span.setStatus('ok');
    }
    span.setAttribute('http.response.status_code', res.statusCode);
    span.end();
    tracer.resetRequestState();
  });
}
