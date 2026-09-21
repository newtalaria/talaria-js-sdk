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
import { attachRequestListener, instrumentOutgoingHttp } from './http.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TalariaNodeInitOptions } from './types.js';

export const Talaria = {
  ...ApiTalaria,
  init(options: TalariaNodeInitOptions): void {
    ApiTalaria.init(options);
    const client = getNodeClient();
    const tracer = client.getTracer();
    const httpOpts = client.getHttpInstrumentOptions();
    if (tracer && httpOpts) {
      client.addTeardown(
        instrumentOutgoingHttp({
          tracer,
          talariaBaseUrl: httpOpts.baseUrl,
          ignoreUrls: httpOpts.ignoreUrls,
        }),
      );
    }
  },
  get analytics() {
    return getNodeClient().analytics;
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
