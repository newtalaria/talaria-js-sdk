# Changelog

## 0.4.1

- Package docs point at the marketing guides.

## 0.4.0

- Project policy from `POST /sdk/getConfig` controls tracing, replay, analytics, heatmaps, and the event sample rate.
- Init no longer accepts `enableTracing`, `tracesSampleRate`, `enableAnalytics`, replay sample rates, or `sampleRate`.
- With no cached policy, the SDK sends errors only. A removed project stays quiet for 24 hours.

## 0.3.1

- Apply remote SDK config (`remoteConfig`, on by default) for sampling, tracing, and analytics.
- Send events through the shared ingest queue.

## 0.2.1

- Per-process `anonymousId` (or init `anonymousId`) stamped on events/spans; session rotation matches the browser SDK.
- Add `Talaria.analytics.track` / `identify` / `page` / `screen` (no autocapture). Consent defaults off; callers should pass `userId` and/or `anonymousId`.

## 0.2.0

- Initial Node SDK: process handlers, `events/ingestBatch`, incoming/outgoing HTTP with `traceparent`, `resetRequestState`, and optional `pg` / `mysql2` / `ioredis` wrappers.
