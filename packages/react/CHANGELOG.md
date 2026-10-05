# Changelog

## 0.5.4

- Depends on `@newtalaria/browser` ^0.5.4. No API changes.

## 0.5.3

- Depends on `@newtalaria/browser` ^0.5.3 (`setContext`, `setExtra`).

## 0.5.2

- Depends on `@newtalaria/browser` ^0.5.2, which records Web Vitals.

## 0.5.1

- Release aligned with `@newtalaria/browser` 0.5.1. No API changes.

## 0.5.0

- **Breaking:** `Talaria.init` no longer accepts `environment`. The API key decides the environment.

## 0.4.2

- Feature flags client parity with Dart (`Talaria.flags`).

## 0.4.1

- Package docs point at the marketing guides.

## 0.4.0

- Project policy from `POST /sdk/getConfig` controls tracing, replay, analytics, heatmaps, and the event sample rate.
- Init no longer accepts `enableTracing`, `tracesSampleRate`, `enableAnalytics`, replay sample rates, or `sampleRate`.
- With no cached policy, the SDK sends errors only. A removed project stays quiet for 24 hours.

## 0.3.1

- Depend on `@newtalaria/browser` 0.3.1 so React apps pick up remote SDK config and the shared event queue.

## 0.2.1

- Depend on `@newtalaria/browser` 0.2.2 so `Talaria.analytics` and durable identity are available from React apps.

## 0.2.0

- Initial React adapter: `ErrorBoundary`, `reactErrorHandler`, `Profiler` / `withProfiler`, and `instrumentReactRouter`.
