# Changelog

## 0.6.0

- **Breaking:** `dsn` is removed. `Talaria.init` takes `url` and a publishable key `tal_pk_<env>_<cell>_<43><6>` (CRC32 base62 checksum). `tal_sk_` and `tal_mon_` are refused. When `url` is omitted, the host is `https://ingest-<cell>.newtalaria.com` from the key cell. Pass `url` (apps typically set it from `TALARIA_URL`, `NEXT_PUBLIC_TALARIA_URL`, or `VITE_TALARIA_URL`) to override that host. A `self` cell requires `url`.
- **Breaking:** Ingest is v1 REST with `Authorization: Bearer` and plain JSON batches. Errors are `application/problem+json`. Routes: `POST /v1/events`, `/v1/spans`, `/v1/analytics`, `/v1/flags/evaluate`, `/v1/replays`, `/v1/replays/segments`, `/v1/replays/{replayId}/finish`, `/v1/heatmaps`, `/v1/heatmaps/snapshots`; `GET /v1/sdk-config`; `POST /v1/client-reports`.
- Depends on `@newtalaria/core` ^0.6.0.
- Replay segments and heatmap snapshots go as raw gzip to `POST /v1/replays/segments` and `POST /v1/heatmaps/snapshots` when the server advertises `capabilities.binaryUploads`, instead of base64 inside JSON (about 25% smaller on the wire). Page-close sends stay JSON. If a binary route answers 404, 405, or 415, the SDK switches back to JSON for good and resends there.
- Event titles are `<Type>: <message>` (truncated to 120 characters) instead of the bare exception type, for errors and synthetic network errors.
- A rejected `POST /v1/replays` no longer re-throws from fire-and-forget upload tasks, so it is not captured as a `TransportError` issue; the next flush retries.

## 0.5.4

- Release aligned with `@newtalaria/node` 0.5.4. No API changes.

## 0.5.3

- `Talaria.setContext` and `Talaria.setExtra` attach named context and extra to captured events.

## 0.5.2

- Record one LCP, INP, CLS, and TTFB sample per document load as a `browser.web_vital` child span. The sample stays on the pageload trace after a client-side navigation and does not lengthen the route transaction.

## 0.5.1

- The browser SDK follows CookieYes, Cookiebot, and Google Consent Mode `analytics_storage`. Analytics, heatmaps, and session replay wait for that choice. Errors still send. Other banners keep using `analytics.optIn()` / `optOut()`.

## 0.5.0

- **Breaking:** `Talaria.init` no longer accepts `environment`. The API key decides the environment. Events, spans, analytics, replay, and heatmaps omit the `environment` field.

## 0.4.2

- A trace stores at most 200 spans. The root records `dropped_span_count` when a span is dropped.
- Breadcrumbs keep at most 15 query crumbs. The other 35 slots stay available for application crumbs.
- Add `Talaria.flags` (`boolVariation` / `stringVariation` / `jsonVariation`, `setContext`). Honors `flags.enabled` from `sdk/getConfig` and stamps `flag.<key>` on events, spans, and analytics.

## 0.4.1

- Package docs point at the marketing guides. Example apps no longer pass removed init options.

## 0.4.0

- Project policy from `POST /sdk/getConfig` controls tracing, replay, analytics, heatmaps, and the event sample rate.
- Init no longer accepts `enableTracing`, `tracesSampleRate`, `enableAnalytics`, replay sample rates, or `sampleRate`.
- With no cached policy, the SDK sends errors only. A removed project stays quiet for 24 hours.

## 0.3.1

- Apply remote SDK config (`remoteConfig`, on by default) for sampling, tracing, replay, analytics, and heatmaps.
- Send events through the shared ingest queue.

## 0.2.2

- Persist `anonymousId` (`talaria.anonymousId`) and rotate `sessionId` after 30 minutes idle or midnight UTC.
- Add `Talaria.analytics` (opt-in product analytics, auto `$pageview` on History navigations, first-touch UTM). Default off.

## 0.2.1

- End pageload and SPA navigation transactions on idle (2s after the last child, 30s max) instead of padding every root to 10s.
- Stop attaching automatic HTTP / Web Vital spans after the transaction has ended.
- Drop Next.js RSC/prefetch (`__next.*`, `/_next/`) and Cloudflare `/cdn-cgi/` from auto HTTP spans and breadcrumbs.
- Errors while a transaction is still open cancel idle and end the root at the error time; later errors only correlate via the last `traceId`/`spanId`.

## 0.2.0

- Extract shared ingest/transport into `@newtalaria/core`.
- Send events via `events/ingestBatch` (a single leftover item is still a batch of one).
- Add runtime `setUser`, `addBreadcrumb`, `startSpan`, `startInactiveSpan`, and `startNavigation`.
- Instrument History API navigations as new transactions when tracing is on.
- Load rrweb with a dynamic import so the ESM bundle can code-split replay.

## 0.1.26

- Upload error-clip replay segments in one `replays/ingestSegmentBatch` call.
- Snapshot error breadcrumbs before replay flush and omit Talaria ingest URLs from the breadcrumb buffer.

## 0.1.25

- Disable event, span, and replay ingest for this page after a permanent client error (`retry: false` / invalid API key). Quota and 5xx keep sending.
- Align `SDK_VERSION` with the published package version.
