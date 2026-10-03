export type {
  BeforeSendEvent,
  BeforeSendHint,
  Breadcrumb,
  CaptureContext,
  CoreInitOptions,
  DebugImage,
  DebugMeta,
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

export { Scope, type ScopeContext } from './scope.js';

export {
  AnalyticsFacade,
  type AnalyticsBindings,
  type AnalyticsCallOptions,
  type AnalyticsPageContext,
  type AnalyticsRuntimeContext,
} from './analytics.js';

export {
  FEATURE_FLAG_CALLED,
  FLAGS_CACHE_KEY_PREFIX,
  MAX_STAMP_FLAGS,
  TalariaFlags,
  type FlagsClientOptions,
} from './flags/flags_client.js';
export {
  decodeValueJson,
  encodeValueJson,
  flagEvaluationFromWire,
  flagEvaluationToCacheJson,
  type FlagEvaluationResult,
} from './flags/flag_evaluation.js';
export {
  evaluateFlags,
  type EvaluateFlagsInput,
} from './transport/flags.js';

export {
  ANONYMOUS_ID_KEY,
  IdentityStore,
  SESSION_ID_KEY,
  SESSION_INACTIVITY_MS,
  SESSION_TOUCHED_AT_KEY,
  SESSION_UTM_KEY,
  createMemoryStorage,
  createWebStorage,
  parseFirstTouch,
  sanitizeTelemetryUrl,
  utcDateKey,
  type FirstTouchAttribution,
  type IdentityStorage,
  type IdentityStoreOptions,
  type TouchSessionOptions,
} from './identity.js';

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
  EVENT_FLUSH_INTERVAL_MS,
  EventIngestQueue,
  MAX_EVENT_BATCH,
} from './transport/event_queue.js';
export {
  ingestSpanBatch,
  type IngestSpanParams,
  type SpanEventInput,
  type SpanKind,
  type SpanLinkInput,
  type SpanStatus,
} from './transport/spans.js';
export {
  ANALYTICS_DEFAULT_NAMES,
  ingestAnalyticsEventBatch,
  MAX_ANALYTICS_BATCH,
  serializeAnalyticsEvent,
  type AnalyticsEventKind,
  type IngestAnalyticsEventParams,
} from './transport/analytics.js';

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
  MAX_OTHER_BREADCRUMBS,
  MAX_QUERY_BREADCRUMBS,
  navigationBreadcrumb,
  normalizeBreadcrumb,
} from './tracing/breadcrumbs.js';

export {
  SDK_CONFIG_SCHEMA,
  cacheKey,
  clampTtlSeconds,
  clearPolicyCache,
  disabledSignal,
  documentIsFresh,
  fetchSdkConfig,
  keyHash,
  parseSdkConfig,
  readPolicyCache,
  reportDiscards,
  tombstoneFromError,
  tombstoneIsQuiet,
  writePolicyCache,
  type SdkConfigDocument,
  type SdkMeterPolicy,
  type SdkPolicyCacheEntry,
  type SdkPolicyStorage,
} from './policy/sdk_policy.js';

export { createId } from './utils/id.js';
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
