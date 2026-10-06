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

/** Own methods only. Spreading the API object would call the `flags` getter before init. */
function apiMethods(source: typeof ApiTalaria): Omit<typeof ApiTalaria, 'analytics' | 'flags'> {
  const out = {} as Omit<typeof ApiTalaria, 'analytics' | 'flags'>;
  for (const key of Object.keys(source) as Array<keyof typeof ApiTalaria>) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || typeof descriptor.get === 'function') continue;
    if (typeof descriptor.value !== 'function') continue;
    (out as Record<string, unknown>)[key] = descriptor.value;
  }
  return out;
}

export const Talaria = {
  ...apiMethods(ApiTalaria),
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

export { wrapDuckDB, wrapMysql2, wrapPg, wrapQueryable, wrapRedis } from './db/index.js';
export { wrapModelFetch } from './model_http.js';

export default Talaria;
