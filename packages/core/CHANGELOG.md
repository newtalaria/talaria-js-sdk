# Changelog

## 0.6.0

### TIS v0.2 Naming Lock (Breaking Changes)

**MIGRATION NOTE:** This release implements the Talaria Integration Standard v0.2 naming lock as a hard cut with no backwards compatibility.

- **Configuration:** `dsn` is removed. Init takes `url` only. When `url` and `TALARIA_URL` are both unset, the host is `https://ingest-<cell>.newtalaria.com`, derived from the key cell. A `self` cell fails fast.
- **Environment variables:** 
  - Public prefixes (`NEXT_PUBLIC_` / `VITE_`) only for `TALARIA_URL`, `TALARIA_BROWSER_API_KEY`, `TALARIA_RELEASE`, and `TALARIA_COMMIT_SHA`
  - Server: unprefixed `TALARIA_URL`, `TALARIA_API_KEY` (`tal_sk_`), `TALARIA_RELEASE_KEY` (`tal_sk_`), plus `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`
- **API keys:** `tal_pk_<env>_<cell>_<43><6>` and `tal_sk_<env>_<cell>_<43><6>` with a CRC32 base62 checksum. Monitor tokens are `tal_mon_<cell>_…`. Browser builds refuse `sk` and `mon`. Node warns once on a `pk` key. Auth is `Authorization: Bearer` only. Bodies are plain JSON (`{"events":[…]}` and the other plural batches). Errors are `application/problem+json`.
- **Ingest paths:** `POST /v1/events`, `/v1/spans`, `/v1/analytics`, `/v1/flags/evaluate`, `/v1/replays`, `/v1/replays/segments`, `/v1/replays/{replayId}/finish`, `/v1/heatmaps`, `/v1/heatmaps/snapshots`, `/v1/releases`, `/v1/source-maps`; `GET /v1/flags` (definitions, sk); `GET /v1/sdk-config`; `POST /v1/client-reports`.
- **OpenTelemetry:** Node SDK reads `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` with precedence: code > TALARIA_* > OTEL_* > CI > default

### Other Changes

- `POST /v1/client-reports` sends `{"discards":[{"signal","reason","count"}]}`.
- `ServerpodTransport` gzips JSON bodies of 1 KB and up (`Content-Encoding: gzip`, via `CompressionStream`) once `GET /v1/sdk-config` returns `capabilities.gzipRequests: true`. `fetchSdkConfig` applies the capabilities, and a response without them turns them off. Keepalive (page-close) sends are never gzipped. A 415 on a gzipped body resends it plain and stops compressing.
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
