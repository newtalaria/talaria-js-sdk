export type {
  BeforeSendEvent,
  BeforeSendHint,
  Breadcrumb,
  CaptureContext,
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
} from '@newtalaria/core';

import type {
  BeforeSendEvent,
  BeforeSendHint,
  Environment,
  LoggerPreset,
  SeverityLevel,
} from '@newtalaria/core';

/** Single status or inclusive [min, max] range. */
export type FailedRequestStatusCode = number | [number, number];

export interface TalariaInitOptions {
  /**
   * Talaria API base URL, e.g. `https://api.newtalaria.com`.
   * Alias of `baseUrl`.
   */
  dsn?: string;
  /** Same as `dsn` — prefer one of the two. */
  baseUrl?: string;
  /** Project API key (`tal_live_…`). */
  apiKey: string;
  environment: Environment | string;
  release?: string;
  /**
   * Git commit SHA for the deployed build (full or abbreviated).
   * Prefer pairing with `release` and a Talaria `createRelease` call in CI.
   */
  commitSha?: string;
  /**
   * Default / root minimum severity for unset scopes and direct client captures.
   * Default `'debug'` (nothing filtered). Production recommendation: `'warning'`.
   * When `enforceDefaultLevel` is false, scoped loggers may override below this.
   */
  minLevel?: SeverityLevel;
  /**
   * When true, scoped loggers cannot log below `minLevel` (legacy hard floor).
   * Default `false` — Logback/MEL-style overrides allowed.
   */
  enforceDefaultLevel?: boolean;
  /**
   * Named logger presets for `Talaria.logger('name')` /
   * `Talaria.logger({ name, ... })`.
   */
  loggers?: Record<string, LoggerPreset>;
  /**
   * Fraction of eligible events to send (0–1). Default `1`.
   * Applied after `minLevel`, before `beforeSend`. Independent of replay sample rates.
   */
  sampleRate?: number;
  /**
   * Return `null` to drop; otherwise return the (possibly mutated) event.
   * Runs after `minLevel` and `sampleRate` gates.
   */
  beforeSend?: (
    event: BeforeSendEvent,
    hint: BeforeSendHint,
  ) => BeforeSendEvent | null;
  /**
   * Drop events whose message matches a string (substring) or RegExp.
   * Merged with Talaria's default known-noise list.
   */
  ignoreErrors?: Array<string | RegExp>;
  /**
   * Drop events when a stack frame URL matches. Secondary to `ignoreErrors`.
   */
  ignoreUrls?: Array<string | RegExp>;
  /** Fraction of sessions that upload continuously (0–1). Default `0`. */
  replaysSessionSampleRate?: number;
  /**
   * Fraction of errors that promote the ring buffer to an uploaded replay (0–1).
   * Default `1`. Ignored once `replaysSessionSampleRate` already enabled upload.
   */
  replaysOnErrorSampleRate?: number;
  /**
   * How long to keep uploading after an error-sample hit (ms).
   * - Default `15000` (~15s): cheap error clip, then finish and return to buffer mode.
   * - `0`: Sentry-like — continue until the 5-minute max duration or page unload.
   */
  replaysErrorAfterMs?: number;
  /** Passed to rrweb. Default `true`. */
  maskAllInputs?: boolean;
  /**
   * Embed accessible stylesheet rules into the snapshot (rrweb `inlineStylesheet`).
   * Default `false` (smaller payloads; player re-fetches public CSS hrefs).
   * Enable for auth-gated UIs (e.g. CMS admin) so same-origin CSS is captured while logged in.
   * Cross-origin sheets without CORS still cannot be inlined.
   */
  inlineStylesheet?: boolean;
  /** CSS selectors blocked from the DOM snapshot (plus `[data-talaria-mask]`). */
  blockSelector?: string;
  /** Optional app user id attached to events / replay start. */
  userId?: string;
  /** Tags merged into every captured event (per-call tags win on key conflict). */
  tags?: Record<string, string>;
  /**
   * Preferred low-cardinality dimensions (optional conventions):
   * `service`, `platform`, `feature`, `operation`, `component`, `runtime`,
   * `runtime_version`. Do not put environment/release or high-cardinality IDs here.
   */
  /** Disable automatic `window` / `unhandledrejection` handlers. */
  disableDefaultIntegrations?: boolean;
  /**
   * Promote matching HTTP fetch/XHR failures to Talaria events for first-party /
   * allowlisted origins (not just replay breadcrumbs). Default `true`.
   */
  captureFailedRequests?: boolean;
  /**
   * Promote fetch/XHR transport failures (no HTTP status) as events for
   * first-party / allowlisted origins. Default `true`. AbortError is never promoted.
   * Third-party failures stay as replay breadcrumbs unless their origin is allowlisted.
   */
  captureNetworkErrors?: boolean;
  /**
   * Extra origins whose failed requests may be promoted (exact origin strings).
   * Same-origin is always eligible. Use `['*']` to promote all origins (not recommended).
   * Example: `['https://api.stripe.com']`.
   * Also controls which outbound fetches receive W3C `traceparent` when tracing is on.
   */
  networkErrorOrigins?: string[];
  /**
   * Keep query strings on network telemetry URLs (after sensitive-key redaction).
   * Default `false` — strips `?…` / `#…` so GA/ads identifiers are not stored.
   * Prefer `captureRequestQueryParameters`.
   */
  includeNetworkUrlQuery?: boolean;
  /**
   * Alias of `includeNetworkUrlQuery`. Privacy-preserving default is `false`.
   */
  captureRequestQueryParameters?: boolean;
  /**
   * Status codes / ranges to promote. Default `[[500, 599]]`.
   * Use `[[400, 599]]` for CMS admin (GridField/PJAX 404s).
   * Only applies to first-party / allowlisted origins.
   */
  failedRequestStatusCodes?: FailedRequestStatusCode[];
  /** Extra URL substrings that must never be promoted (Talaria ingest URLs are always ignored). */
  failedRequestIgnoreUrls?: string[];
  /**
   * Path substrings or RegExps that force stack frames `inApp: true`
   * (checked after built-in denies / denyUrls).
   */
  inAppAllowUrls?: Array<string | RegExp>;
  /**
   * Path substrings or RegExps that force stack frames `inApp: false`.
   */
  inAppDenyUrls?: Array<string | RegExp>;
  /**
   * Extra origins treated as app code for `inApp` (exact origin strings).
   * Same-origin (`window.location.origin`) is always included.
   * Example: `['https://cdn.example.com']` for CDN-hosted app bundles.
   */
  inAppOrigins?: string[];
  /**
   * Enable pageload + fetch/XHR tracing (`spans/ingestBatch`).
   * Off until this is `true` **or** `tracesSampleRate > 0`.
   * Explicit `false` disables tracing even if a sample rate is set.
   */
  enableTracing?: boolean;
  /**
   * Head-based sample rate for successful transactions (0–1).
   * Error transactions are always kept. Default `0.1` when tracing is on.
   */
  tracesSampleRate?: number;
}

export interface ResolvedOptions {
  baseUrl: string;
  apiKey: string;
  /** Wire enum value after alias normalization (`test` → `staging`, etc.). */
  environment: Environment;
  release?: string;
  commitSha?: string;
  minLevel: SeverityLevel;
  enforceDefaultLevel: boolean;
  loggers: Record<string, LoggerPreset>;
  sampleRate: number;
  beforeSend?: (
    event: BeforeSendEvent,
    hint: BeforeSendHint,
  ) => BeforeSendEvent | null;
  ignoreErrors: Array<string | RegExp>;
  ignoreUrls: Array<string | RegExp>;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
  replaysErrorAfterMs: number;
  maskAllInputs: boolean;
  inlineStylesheet: boolean;
  blockSelector: string;
  userId?: string;
  tags?: Record<string, string>;
  disableDefaultIntegrations: boolean;
  captureFailedRequests: boolean;
  captureNetworkErrors: boolean;
  networkErrorOrigins: string[];
  includeNetworkUrlQuery: boolean;
  failedRequestStatusCodes: FailedRequestStatusCode[];
  failedRequestIgnoreUrls: string[];
  inAppAllowUrls: Array<string | RegExp>;
  inAppDenyUrls: Array<string | RegExp>;
  inAppOrigins: string[];
  tracingEnabled: boolean;
  tracesSampleRate: number;
}
