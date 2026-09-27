# Changelog

## 0.4.0

- Project policy from `POST /sdk/getConfig` controls tracing, replay, analytics, heatmaps, and the event sample rate.
- Init no longer accepts `enableTracing`, `tracesSampleRate`, `enableAnalytics`, replay sample rates, or `sampleRate`.
- With no cached policy, the SDK sends errors only. A removed project stays quiet for 24 hours.

## 0.3.1

- Depend on `@newtalaria/core`, `@newtalaria/node`, and `@newtalaria/react` 0.3.1 so App Router apps pick up remote SDK config and the shared event queue.

## 0.2.2

- Pull `@newtalaria/node` 0.2.1 and `@newtalaria/react` 0.2.1 so App Router apps get product analytics and identity stamping.

## 0.2.1

- Also listen for Navigation API `currentchange` so App Router route changes still start a new transaction if History is wrapped by Next.js.

## 0.2.0

- Initial Next.js adapter with `/client`, `/server`, `/edge`, and `/config` entrypoints.
- `initClient`, `initServer`, `captureRequestError`, `withServerAction`, `withRouteHandler`, `withTalariaConfig`.
