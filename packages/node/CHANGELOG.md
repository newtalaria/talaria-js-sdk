# Changelog

## 0.2.1

- Per-process `anonymousId` (or init `anonymousId`) stamped on events/spans; session rotation matches the browser SDK.
- Add `Talaria.analytics.track` / `identify` / `page` / `screen` (no autocapture). Consent defaults off; callers should pass `userId` and/or `anonymousId`.

## 0.2.0

- Initial Node SDK: process handlers, `events/ingestBatch`, incoming/outgoing HTTP with `traceparent`, `resetRequestState`, and optional `pg` / `mysql2` / `ioredis` wrappers.
