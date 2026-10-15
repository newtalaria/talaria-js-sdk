# Changelog

## Unreleased (proposed 0.6.0)

- `withTalariaConfig` tags every event with the release and commit (from options, `TALARIA_RELEASE`, Vercel/GitHub/GitLab/Cloudflare/Render/Netlify/Heroku/Bitbucket/CircleCI env, or git).
- After `next build` (`compiler.runAfterProductionCompile`), with `TALARIA_RELEASE_KEY` set: `releases/setCommits` creates the release with commits `previousReleaseCommitSha..HEAD` (max 250); `.next/static` maps are uploaded as `_next/static/...`, verified with `sourceMaps/list`, then the public `.map` files are deleted. `createProjectRelease` (without `projectId`) is only a fallback for servers without setCommits.
- New `talaria-nextjs upload` CLI for the same step at deploy time.
- Adds an empty `turbopack` config so Next 16 builds with Turbopack accept the wrapper.

## 0.5.4

- Depends on `@newtalaria/node` ^0.5.4 (`wrapDuckDB`, database wrappers split by driver).

## 0.5.3

- Server init continues traces on outgoing Node HTTP and `fetch` once tracing is on.
- Edge runtime: `captureMessage`, breadcrumbs on errors, and `setUser`, `setTag`, `setTags`, `setExtra`, and `setContext`.

## 0.5.2

- Release aligned with `@newtalaria/browser` 0.5.2. The client still records Web Vitals through `@newtalaria/browser`.

## 0.5.1

- Release aligned with `@newtalaria/browser` 0.5.1. No API changes.

## 0.5.0

- **Breaking:** Client, server, and edge init no longer accept `environment`. The edge runtime no longer defaults it to production. The API key decides the environment.

## 0.4.2

- Feature flags client parity with Dart (`Talaria.flags`).

## 0.4.1

- Package docs point at the marketing guides.

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
