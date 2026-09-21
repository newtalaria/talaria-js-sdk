export type {
  BeforeSendEvent,
  BeforeSendHint,
  Breadcrumb,
  CaptureContext,
  CoreInitOptions,
  DebugImage,
  DebugMeta,
  Environment,
  ExceptionData,
  ExceptionMechanism,
  ExceptionValue,
  LoggerOptions,
  LoggerPreset,
  SeverityLevel,
  StackFrame,
  StackTrace,
  UserContext,
} from './types.js';

export { Scope } from './scope.js';

export {
  ServerpodTransport,
  type ServerpodTransportOptions,
} from './transport/serverpod.js';
export {
  IngestError,
  TransportError,
  type IngestSignal,
} from './transport/ingest_error.js';
export {
  ingestEvent,
  ingestEventBatch,
  type IngestEventParams,
} from './transport/events.js';
export {
  ingestSpanBatch,
  type IngestSpanParams,
  type SpanEventInput,
  type SpanKind,
  type SpanLinkInput,
  type SpanStatus,
} from './transport/spans.js';

export {
  DEFAULT_TRACES_SAMPLE_RATE,
  headSample,
  isTracingEnabled,
  resolveTracesSampleRate,
  shouldKeepTransaction,
  type TracingSampleOptions,
} from './tracing/sampling.js';
export {
  createSpanId,
  createTraceId,
  isSpanId,
  isTraceId,
  randomHex,
} from './tracing/ids.js';
export {
  getCurrentSpanContext,
  setCurrentSpanContext,
  type SpanContext,
} from './tracing/context.js';
export {
  extractTraceparent,
  formatTraceparent,
  parseTraceparent,
  toSpanContext,
  type TraceParent,
} from './tracing/traceparent.js';
export {
  NoopSpan,
  RecordingSpan,
  stringifyAttr,
  stringifyAttrMap,
  toIngestSpan,
  type MutableSpan,
  type Span,
} from './tracing/span.js';
export {
  BreadcrumbBuffer,
  consoleBreadcrumb,
  MAX_BREADCRUMBS,
  navigationBreadcrumb,
  normalizeBreadcrumb,
} from './tracing/breadcrumbs.js';

export { createId } from './utils/id.js';
export { normalizeEnvironment } from './utils/environment.js';
export {
  maxSeverity,
  normalizeSeverity,
  SEVERITY_ORDER,
  severityAtLeast,
} from './utils/severity.js';
export {
  HIGH_CARDINALITY_TAG_KEYS,
  looksHighCardinalityValue,
  MAX_TAG_KEY_LENGTH,
  MAX_TAG_TOTAL_UTF8_BYTES,
  MAX_TAG_VALUE_LENGTH,
  MAX_TAGS_PER_EVENT,
  mergeTags,
  normalizeTags,
  RESERVED_TAG_KEYS,
  warnSuspiciousTags,
  type TagMap,
} from './utils/tags.js';
