# Changelog

## Unreleased


## 0.4.2

- Identical SQL under one parent is one span with `db.query.count` and `db.query.duration_sum_ms`. Queries of 200ms or more, and failed queries, stay their own spans.
- A transaction stores at most 200 spans and keeps 32 slots for non-SQL spans. The root records `dropped_span_count` when a span is dropped.
- `withoutQuerySpans` and `setRecordQuerySpans(false)` turn automatic SQL spans off for one run.
- Query breadcrumbs use at most 15 of the 50 breadcrumb slots.
- Add `Talaria.flags` (`boolVariation` / `stringVariation` / `jsonVariation`, `setContext`). Honors `flags.enabled` from `sdk/getConfig` and stamps `flag.<key>` on events, spans, and analytics.

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
