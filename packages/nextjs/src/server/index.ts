export {
  Talaria,
  handleHttpRequest,
  wrapMysql2,
  wrapPg,
  wrapRedis,
} from '@newtalaria/node';

export type { TalariaNodeInitOptions } from '@newtalaria/node';

import { Talaria } from '@newtalaria/node';
import type { TalariaNodeInitOptions } from '@newtalaria/node';

/** Call from `sentry.server.config.ts`-style files or `instrumentation.ts` (nodejs). */
export function initServer(options: TalariaNodeInitOptions): void {
  Talaria.init(options);
}

/**
 * Next.js `instrumentation.ts` `onRequestError` hook.
 */
export function captureRequestError(
  error: unknown,
  request: { path?: string; method?: string },
): void {
  void Talaria.captureException(error, {
    mechanism: { type: 'auto.function.nextjs.on_request_error', handled: false },
    extra: {
      path: request.path ?? '',
      method: request.method ?? '',
    },
  });
}

/** Wrap a Server Action so thrown errors become events. */
export function withServerAction<T extends (...args: never[]) => Promise<unknown>>(
  name: string,
  action: T,
): T {
  const wrapped = (async (...args: never[]) => {
    const span = Talaria.startSpan(`action ${name}`, {
      kind: 'internal',
      attributes: { 'next.action': name },
    });
    try {
      const result = await action(...args);
      span?.setStatus('ok');
      span?.end();
      return result;
    } catch (error) {
      span?.setStatus('error');
      span?.end();
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
    const span = Talaria.startSpan(`route ${name}`, {
      kind: 'server',
      attributes: { 'next.route': name },
    });
    try {
      const result = await handler(...args);
      span?.setStatus('ok');
      span?.end();
      return result;
    } catch (error) {
      span?.setStatus('error');
      span?.end();
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
