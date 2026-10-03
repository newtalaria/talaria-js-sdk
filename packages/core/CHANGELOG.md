# Changelog

## 0.5.3

- Named context and extra on the scope (`setContext`, `setExtra`). Call-site extra still wins.

## 0.5.2

- Release aligned with `@newtalaria/browser` 0.5.2. No API changes.

## 0.5.1

- Release aligned with `@newtalaria/browser` 0.5.1. No API changes.

## 0.5.0

- **Breaking:** `init` no longer accepts `environment`. The API key decides the environment. Events, spans, and analytics omit the `environment` field. `normalizeEnvironment` and the `Environment` type are removed.

## 0.4.2

- Add `Talaria.flags` (`boolVariation` / `stringVariation` / `jsonVariation`, `setContext`) via `POST /flags/evaluate`.
- Apply `flags.enabled` from `sdk/getConfig`. Stamp up to 20 `flag.<key>` tags on events, spans, and analytics.
- Cache evaluations in localStorage (browser) / memory (Node); poll on the policy TTL.

## 0.4.1

- Package docs point at the marketing guides.

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
