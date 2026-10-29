# Changelog

## 0.6.0

- **Breaking:** `dsn` is removed. Init takes `url` or `TALARIA_URL`. When both are unset, the host is `https://ingest-<cell>.newtalaria.com` from the key cell. A `self` cell requires `url` or `TALARIA_URL`.
- **Breaking:** `apiKey` / `TALARIA_API_KEY` must be `tal_sk_<env>_<cell>_<43><6>` (CRC32 base62 checksum). A `tal_pk_` key warns once. `tal_mon_` is refused. Auth is `Authorization: Bearer`. Errors are `application/problem+json`.
- **Breaking:** Ingest is v1 REST: `POST /v1/events`, `/v1/spans`, `/v1/analytics`, `/v1/flags/evaluate`; `GET /v1/flags` (definitions); `GET /v1/sdk-config`; `POST /v1/client-reports`. Bodies are plain JSON batches.
- Reads `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` (code, then `OTEL_*`, then the default).
- Depends on `@newtalaria/core` ^0.6.0.

## 0.5.4

- Optional `wrapDuckDB` records a CLIENT span and a query breadcrumb for `@duckdb/node-api` (`run`, `stream`, `prepare`, `runAndRead*`, and pending `start`). Bound parameter values and result rows stay in the app. A thrown query calls `captureException` with the sanitized statement.
- Database wrappers live in `src/db/` (`pg`, `mysql`, `redis`, `duckdb`). `wrapPg`, `wrapMysql2`, `wrapRedis`, `wrapQueryable`, and `wrapDuckDB` are unchanged.
- `wrapRedis` reads the command name from an ioredis `Command` (`name`) as well as from a `node-redis` argument array.
- Importing `@newtalaria/node` no longer reads `flags` before `Talaria.init`.

## 0.5.3

- `setContext` and `setExtra` on the Node client.
- Outgoing `http`, `https`, and `fetch` get a client span and `traceparent` when project config turns tracing on. The patch waits for that config, including calls that start before it arrives. Talaria ingest URLs are skipped.

## 0.5.2

- Release aligned with `@newtalaria/browser` 0.5.2. No API changes.

## 0.5.1

- Release aligned with `@newtalaria/browser` 0.5.1. No API changes.

## 0.5.0

- **Breaking:** `Talaria.init` no longer accepts `environment`. The API key decides the environment. Events, spans, and analytics omit the `environment` field.

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
