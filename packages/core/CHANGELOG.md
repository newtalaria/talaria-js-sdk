# Changelog

## Unreleased (proposed 0.5.6)

### TIS v0.2 Naming Lock (Breaking Changes)

**MIGRATION NOTE:** This release implements the Talaria Integration Standard v0.2 naming lock as a hard cut with no backwards compatibility.

- **Configuration:** Replaced `dsn` and `baseUrl` options with `url`. Default changed from `http://localhost:8080` to `https://ingest.newtalaria.com`.
- **Environment variables:** 
  - Browser: Use `TALARIA_URL` and `TALARIA_BROWSER_API_KEY` (no `NEXT_PUBLIC_` or `VITE_` prefixes needed; configure via `next.config.js` `env` or `vite.config.ts` `envPrefix`)
  - Server: Use `TALARIA_URL`, `TALARIA_API_KEY`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`
  - Removed: `TALARIA_DSN`, `TALARIA_BASE_URL`, `NEXT_PUBLIC_TALARIA_DSN`, `VITE_TALARIA_DSN`
- **API key prefixes:** Changed from `tal_live_` to environment-specific: `tal_prod_`, `tal_stg_`, `tal_test_`, `tal_dev_`
- **Ingest paths:** All endpoints now use `/v1/*`:
  - `/v1/events` (was `events/ingestBatch`)
  - `/v1/spans` (was `spans/ingestBatch`)
  - `/v1/analytics` (was `analytics/ingestBatch`)
  - `/v1/flags` (was `flags/evaluate`)
  - POST `/v1/replays`, POST `/v1/replays/segments`, PUT `/v1/replays/{replayId}` (was `replays/start`, `replays/ingestSegment`, `replays/finish`)
  - POST `/v1/heatmaps`, POST `/v1/heatmaps/snapshots` (was `heatmaps/ingestBatch`, `heatmaps/uploadSnapshot`)
  - `/v1/source-maps` (CLI)
- **OpenTelemetry:** Node SDK now reads `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` with precedence: code > TALARIA_* > OTEL_* > CI > default

### Other Changes

- `ServerpodTransport` gzips JSON bodies of 1 KB and up (`Content-Encoding: gzip`, via `CompressionStream`) once `sdk/getConfig` returns `capabilities.gzipRequests: true`. `fetchSdkConfig` applies the capabilities, and a response without them (an older server) turns them off. Keepalive (page-close) sends are never gzipped. A 415 on a gzipped body resends it plain and stops compressing.
- `ServerpodTransport.capabilities`, `setCapabilities`, `disableBinaryUploads` and `callBinary` (raw bytes to a binary upload route) are new.
- `ServerpodTransport` now supports PUT via `CallOptions.method`
- `readProcessReleaseEnv` also reads literal `process.env.NEXT_PUBLIC_TALARIA_RELEASE` / `NEXT_PUBLIC_TALARIA_COMMIT_SHA`, so bundler-inlined values tag browser events.

## 0.5.5

- Resolve a release from GitHub Actions or GitLab when `TALARIA_RELEASE` is unset. The source map CLI uses this.

## 0.5.4

- Release aligned with `@newtalaria/node` 0.5.4. No API changes.

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
