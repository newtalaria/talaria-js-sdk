# Changelog

## 0.4.0

- Project policy from `POST /sdk/getConfig` controls tracing, replay, analytics, heatmaps, and the event sample rate.
- Init no longer accepts `enableTracing`, `tracesSampleRate`, `enableAnalytics`, replay sample rates, or `sampleRate`.
- With no cached policy, the SDK sends errors only. A removed project stays quiet for 24 hours.

## 0.3.1

- Fetch and cache remote SDK config, and report client discards.
- Share one event ingest queue (50 events or 2 seconds) across browser and Node.

## 0.2.1

- Stamp durable `anonymousId` + rotating `sessionId` (30 min idle or midnight UTC) on events and spans.
- Add `Talaria.analytics` (`identify` / `track` / `page` / `screen` / `reset` / `optIn` / `optOut`) posting `analytics/ingestBatch`. Consent defaults off.

## 0.2.0

- Initial shared package: Serverpod transport, event/span batch ingest, sampling, W3C `traceparent`, and mutable scope (`setUser`, tags).
