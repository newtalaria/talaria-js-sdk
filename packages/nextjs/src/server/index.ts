export { Talaria } from '@newtalaria/node/api';
export type { TalariaNodeInitOptions } from '@newtalaria/node/api';

import { getNodeClient, Talaria } from '@newtalaria/node/api';
import { installOutgoingHttpInstrumentation } from '@newtalaria/node';
import { logRateLimited } from '@newtalaria/core';
import type { TalariaNodeInitOptions } from '@newtalaria/node/api';

/**
 * Call from `talaria.server.config.ts` or `instrumentation.ts` (nodejs).
 * Outgoing `http` / `https` gets a client span and `traceparent` once tracing is on.
 */
export function initServer(options: TalariaNodeInitOptions): void {
  Talaria.init(options);
  if (!getNodeClient().isEnabled()) return;
  try {
    installOutgoingHttpInstrumentation(getNodeClient());
  } catch (error) {
    logRateLimited('@newtalaria/nextjs:internal', '@newtalaria/nextjs: http instrumentation failed (ignored)', error);
  }
}

/** Start a span; a Talaria fault never reaches the wrapped handler. */
function safeSpan(name: string, opts: Parameters<typeof Talaria.startSpan>[1]): ReturnType<typeof Talaria.startSpan> {
  try {
    return Talaria.startSpan(name, opts);
  } catch {
    return null;
  }
}

function endSpan(span: ReturnType<typeof Talaria.startSpan>, status: 'ok' | 'error'): void {
  try {
    span?.setStatus(status);
    span?.end();
  } catch {
    /* ignore */
  }
}

/**
 * Next.js `instrumentation.ts` `onRequestError` hook.
 */
export function captureRequestError(
  error: unknown,
  request: { path?: string; method?: string },
): void {
  try {
    void Talaria.captureException(error, {
      mechanism: { type: 'auto.function.nextjs.on_request_error', handled: false },
      extra: {
        path: request?.path ?? '',
        method: request?.method ?? '',
      },
    });
  } catch {
    /* Talaria never breaks the request (D19) */
  }
}

/** Wrap a Server Action so thrown errors become events. */
export function withServerAction<T extends (...args: never[]) => Promise<unknown>>(
  name: string,
  action: T,
): T {
  const wrapped = (async (...args: never[]) => {
    const span = safeSpan(`action ${name}`, {
      kind: 'internal',
      attributes: { 'next.action': name },
    });
    try {
      const result = await action(...args);
      endSpan(span, 'ok');
      return result;
    } catch (error) {
      endSpan(span, 'error');
      await Talaria.captureException(error, {
        mechanism: { type: 'auto.function.nextjs.server_action', handled: false },
        extra: { action: name },
      });
      throw error;
    }
  }) as T;
  return wrapped;
}

/** Wrap a Route Handler. */
export function withRouteHandler<T extends (...args: never[]) => Promise<Response> | Response>(
  name: string,
  handler: T,
): T {
  const wrapped = (async (...args: never[]) => {
    const span = safeSpan(`route ${name}`, {
      kind: 'server',
      attributes: { 'next.route': name },
    });
    try {
      const result = await handler(...args);
      endSpan(span, 'ok');
      return result;
    } catch (error) {
      endSpan(span, 'error');
      await Talaria.captureException(error, {
        mechanism: { type: 'auto.function.nextjs.route_handler', handled: false },
        extra: { route: name },
      });
      throw error;
    }
  }) as T;
  return wrapped;
}

export { register } from '../register.js';

export default Talaria;
