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
    _maybeCb?: (res: IncomingMessage) => void,
  ) {
    const options =
      typeof urlOrOpts === 'string' || urlOrOpts instanceof URL
        ? typeof cbOrOpts === 'object'
          ? cbOrOpts
          : {}
        : urlOrOpts;
    const url = requestUrl(
      typeof urlOrOpts === 'string' || urlOrOpts instanceof URL ? urlOrOpts : options,
      protocol,
    );
    if (isIgnored(url, opts)) {
      return original.apply(this, arguments as unknown as Parameters<typeof original>);
    }

    const ctx = getCurrentSpanContext();
    if (ctx && options && typeof options === 'object') {
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
    const req = original.apply(this, arguments as unknown as Parameters<typeof original>);
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
  return () => {
    (mod as { request: typeof original }).request = original;
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
