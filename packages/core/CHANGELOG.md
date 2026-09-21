# Changelog

## 0.2.1

- Stamp durable `anonymousId` + rotating `sessionId` (30 min idle or midnight UTC) on events and spans.
- Add `Talaria.analytics` (`identify` / `track` / `page` / `screen` / `reset` / `optIn` / `optOut`) posting `analytics/ingestBatch`. Consent defaults off.

## 0.2.0

- Initial shared package: Serverpod transport, event/span batch ingest, sampling, W3C `traceparent`, and mutable scope (`setUser`, tags).
