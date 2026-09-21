# Changelog

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
