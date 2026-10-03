export {
  TalariaNodeClient,
  getNodeClient,
  ingestEvent,
  ingestEventBatch,
  ingestSpanBatch,
  ingestAnalyticsEventBatch,
  parseTraceparent,
  formatTraceparent,
  isTracingEnabled,
} from './api.js';
export type {
  Breadcrumb,
  CaptureContext,
  SeverityLevel,
  Span,
  TalariaNodeInitOptions,
  UserContext,
  AnalyticsCallOptions,
  AnalyticsEventKind,
  IngestAnalyticsEventParams,
} from './api.js';

export {
  attachRequestListener,
  continueTraceFromRequest,
  instrumentOutgoingHttp,
} from './http.js';

import { getNodeClient, Talaria as ApiTalaria } from './api.js';
import { attachRequestListener } from './http.js';
import { installOutgoingHttpInstrumentation } from './outgoing.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TalariaNodeInitOptions } from './types.js';

export { installOutgoingHttpInstrumentation } from './outgoing.js';

export const Talaria = {
  ...ApiTalaria,
  init(options: TalariaNodeInitOptions): void {
    ApiTalaria.init(options);
    installOutgoingHttpInstrumentation(getNodeClient());
  },
  get analytics() {
    return getNodeClient().analytics;
  },
  get flags() {
    return getNodeClient().flags;
  },
};

/** Start a SERVER span for this request and reset state when the response finishes. */
export function handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
  const tracer = getNodeClient().getTracer();
  if (!tracer) return;
  attachRequestListener(req, res, tracer);
}

export { wrapMysql2, wrapPg, wrapQueryable, wrapRedis } from './db.js';

export default Talaria;
