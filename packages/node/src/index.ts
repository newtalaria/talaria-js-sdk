import { TalariaNodeClient } from './client.js';
import type { CaptureContext, SeverityLevel, UserContext } from '@newtalaria/core';
import type { TalariaNodeInitOptions } from './types.js';

const client = new TalariaNodeClient();

export const Talaria = {
  init(options: TalariaNodeInitOptions): void {
    client.init(options);
  },
  captureException(error: unknown, context?: CaptureContext): Promise<void> {
    return client.captureException(error, context);
  },
  captureMessage(
    message: string,
    level?: SeverityLevel,
    context?: CaptureContext,
  ): Promise<void> {
    return client.captureMessage(message, level, context);
  },
  setUser(user: UserContext | null): void {
    client.setUser(user);
  },
  addBreadcrumb: client.addBreadcrumb.bind(client),
  startSpan: client.startSpan.bind(client),
  startInactiveSpan: client.startInactiveSpan.bind(client),
  startTransaction: client.startTransaction.bind(client),
  resetRequestState(): void {
    client.resetRequestState();
  },
  getTraceId(): string | null {
    return client.getTraceId();
  },
  getSpanId(): string | null {
    return client.getSpanId();
  },
  flush(): Promise<void> {
    return client.flush();
  },
  close(): Promise<void> {
    return client.close();
  },
};

export { TalariaNodeClient } from './client.js';
export {
  attachRequestListener,
  continueTraceFromRequest,
  instrumentOutgoingHttp,
} from './http.js';

import { attachRequestListener } from './http.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Start a SERVER span for this request and reset state when the response finishes. */
export function handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
  const tracer = client.getTracer();
  if (!tracer) return;
  attachRequestListener(req, res, tracer);
}
export { wrapMysql2, wrapPg, wrapQueryable, wrapRedis } from './db.js';
export type { TalariaNodeInitOptions } from './types.js';
export {
  ingestEvent,
  ingestEventBatch,
  ingestSpanBatch,
  parseTraceparent,
  formatTraceparent,
  isTracingEnabled,
} from '@newtalaria/core';
export type {
  Breadcrumb,
  CaptureContext,
  SeverityLevel,
  Span,
  UserContext,
} from '@newtalaria/core';

export default Talaria;
