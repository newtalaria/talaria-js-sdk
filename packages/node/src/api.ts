import { TalariaNodeClient } from './client.js';
import type { CaptureContext, SeverityLevel, UserContext } from '@newtalaria/core';
import type { TalariaNodeInitOptions } from './types.js';

const client = new TalariaNodeClient();

/** HTTP-free facade so Next.js server wrappers do not pull `node:http`. */
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
  get analytics() {
    return client.analytics;
  },
  flush(): Promise<void> {
    return client.flush();
  },
  close(): Promise<void> {
    return client.close();
  },
};

export function getNodeClient(): TalariaNodeClient {
  return client;
}

export { TalariaNodeClient } from './client.js';
export type { TalariaNodeInitOptions } from './types.js';
export {
  ingestEvent,
  ingestEventBatch,
  ingestSpanBatch,
  ingestAnalyticsEventBatch,
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
  AnalyticsCallOptions,
  AnalyticsEventKind,
  IngestAnalyticsEventParams,
} from '@newtalaria/core';

export default Talaria;
