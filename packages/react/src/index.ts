export {
  Talaria,
  TalariaClient,
  ingestEvent,
  ingestEventBatch,
  ingestSpanBatch,
  parseTraceparent,
  formatTraceparent,
  isTracingEnabled,
  resolveTracesSampleRate,
  DEFAULT_TRACES_SAMPLE_RATE,
  MAX_BREADCRUMBS,
  mergeTags,
  normalizeTags,
} from '@newtalaria/browser';

export type {
  Breadcrumb,
  CaptureContext,
  SeverityLevel,
  Span,
  TalariaInitOptions,
  UserContext,
} from '@newtalaria/browser';

export { ErrorBoundary, type ErrorBoundaryFallback, type ErrorBoundaryProps } from './error_boundary.js';
export { reactErrorHandler, type ReactErrorInfo } from './error_handler.js';
export { Profiler, withProfiler, type ProfilerProps } from './profiler.js';
export {
  instrumentReactRouter,
  type RouterLocation,
  type SubscribableRouter,
} from './router.js';

import { Talaria } from '@newtalaria/browser';
import { reactErrorHandler } from './error_handler.js';

const ReactTalaria = Object.assign(Talaria, { reactErrorHandler });
export { ReactTalaria };
export default ReactTalaria;
