# Changelog

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
