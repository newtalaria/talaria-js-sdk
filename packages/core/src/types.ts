/** Severity levels accepted by Talaria event ingest. */
export type SeverityLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

/** Environments accepted by Talaria wire enums. */
export type Environment = 'production' | 'staging' | 'development';

/** Mutable event snapshot passed to `beforeSend`. */
export interface BeforeSendEvent {
  message: string;
  level: SeverityLevel;
  eventType: 'error' | 'warning' | 'info' | 'debug';
  title?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  userId?: string;
  exception?: ExceptionData;
}

/** Hint bag for `beforeSend`. */
export interface BeforeSendHint {
  originalContext?: CaptureContext;
  isException: boolean;
}

/** How an exception was captured / produced (mirrors ExceptionMechanismDto). */
export interface ExceptionMechanism {
  type: string;
  handled?: boolean;
  synthetic?: boolean;
}

/**
 * Single stack frame on the wire (mirrors StackFrameDto).
 * Uses `functionName` — not `function` (reserved in Dart / Serverpod).
 */
export interface StackFrame {
  filename?: string;
  absPath?: string;
  functionName?: string;
  rawFunction?: string;
  module?: string;
  package?: string;
  platform?: string;
  lineno?: number;
  colno?: number;
  inApp?: boolean;
  instructionAddr?: string;
  symbolAddr?: string;
  imageAddr?: string;
  addrMode?: string;
  contextLine?: string;
  preContext?: string[];
  postContext?: string[];
  vars?: Record<string, string>;
  stackStart?: boolean;
}

/** Structured stacktrace (mirrors StackTraceDto). Frames are oldest → newest. */
export interface StackTrace {
  frames: StackFrame[];
  registers?: Record<string, string>;
}

/** One exception in a chain (mirrors ExceptionValueDto). */
export interface ExceptionValue {
  type?: string;
  value?: string;
  module?: string;
  threadId?: string;
  code?: string;
  mechanism?: ExceptionMechanism;
  stacktrace?: StackTrace;
}

/** First-class exception payload (mirrors ExceptionDataDto). */
export interface ExceptionData {
  values: ExceptionValue[];
}

/** Optional debug image metadata (mirrors DebugImageDto). */
export interface DebugImage {
  type?: string;
  imageAddr?: string;
  imageSize?: number;
  debugId?: string;
  debugFile?: string;
  codeId?: string;
  codeFile?: string;
  arch?: string;
}

/** Optional debug meta (mirrors DebugMetaDto). */
export interface DebugMeta {
  images?: DebugImage[];
}

/** First-class trail attached to error events (mirrors BreadcrumbDto). */
export interface Breadcrumb {
  timestamp: string;
  type: string;
  category?: string;
  message?: string;
  level?: string;
  data?: Record<string, string>;
}

export interface CaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  userId?: string;
  title?: string;
  mechanism?: ExceptionMechanism;
  source?: {
    filename?: string;
    lineno?: number;
    colno?: number;
  };
}

/** Named logger preset from init `loggers`. */
export interface LoggerPreset {
  tags?: Record<string, string>;
  minLevel?: SeverityLevel;
}

/** Options for scoped loggers. */
export interface LoggerOptions extends LoggerPreset {
  name?: string;
}

/** Runtime identity attached after init. */
export interface UserContext {
  id?: string | null;
}

export interface CoreInitOptions {
  dsn?: string;
  baseUrl?: string;
  apiKey: string;
  environment: Environment | string;
  release?: string;
  commitSha?: string;
  minLevel?: SeverityLevel;
  enforceDefaultLevel?: boolean;
  loggers?: Record<string, LoggerPreset>;
  sampleRate?: number;
  beforeSend?: (
    event: BeforeSendEvent,
    hint: BeforeSendHint,
  ) => BeforeSendEvent | null;
  ignoreErrors?: Array<string | RegExp>;
  userId?: string;
  /**
   * Durable visitor id. Browser persists this in `localStorage`; Node generates
   * per-process unless this is set.
   */
  anonymousId?: string;
  tags?: Record<string, string>;
  enableTracing?: boolean;
  tracesSampleRate?: number;
  /**
   * Product analytics (`analytics/ingestBatch`). Default `false` until
   * `Talaria.analytics.optIn()` or this is `true`. Alias: `analyticsEnabled`.
   */
  enableAnalytics?: boolean;
  /** Alias of {@link enableAnalytics}. */
  analyticsEnabled?: boolean;
}
