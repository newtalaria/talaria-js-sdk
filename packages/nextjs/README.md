# `@newtalaria/nextjs`

Talaria SDK for Next.js 14–16. Install this package only — it pulls React (client) and Node (server).

Docs: [Next.js SDK](https://www.newtalaria.com/docs/sdk/nextjs)

```bash
npm install @newtalaria/nextjs
```

The API key decides the environment.

Use **disjoint entrypoints** so the App Router never bundles Node `http` into the client:

```ts
// instrumentation-client.ts
import { initClient } from '@newtalaria/nextjs/client';

initClient({
  url: process.env.NEXT_PUBLIC_TALARIA_URL,
  apiKey: process.env.NEXT_PUBLIC_TALARIA_BROWSER_API_KEY!, // tal_pk_ only
});
```

```ts
// talaria.server.config.ts
import { initServer } from '@newtalaria/nextjs/server';

initServer({
  url: process.env.TALARIA_URL,
  apiKey: process.env.TALARIA_API_KEY!, // tal_sk_…
});
```

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./talaria.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./talaria.edge.config');
  }
}

export { captureRequestError as onRequestError } from '@newtalaria/nextjs/server';
```

```ts
// next.config.ts
import { withTalariaConfig } from '@newtalaria/nextjs/config';

export default withTalariaConfig({
  // your config
});
```

`withTalariaConfig` does **not** upload source maps. Pair `release` / `commitSha` for dashboard source context.

See `examples/next/` in this repo for `global-error.tsx`, a Server Action, and a Route Handler.

## Releases and source maps

```ts
// next.config.ts
import { withTalariaConfig } from '@newtalaria/nextjs/config';
export default withTalariaConfig({ /* your config */ });
```

- **Release tagging:** the release is `TALARIA_RELEASE`, or `<branch>@<sha7>`. The SHA comes from `VERCEL_GIT_COMMIT_SHA`, `GITHUB_SHA`, `CI_COMMIT_SHA`, `CF_PAGES_COMMIT_SHA`, `RENDER_GIT_COMMIT`, `COMMIT_REF`, `SOURCE_VERSION`, `BITBUCKET_COMMIT` or `CIRCLE_SHA1`, else `git rev-parse HEAD`. Both values are inlined as `NEXT_PUBLIC_TALARIA_RELEASE` and `NEXT_PUBLIC_TALARIA_COMMIT_SHA`, so every event is tagged. Leave `release` out of `Talaria.init`, or set it to the same value.
- **Upload at build time:** set `TALARIA_RELEASE_KEY` (a `tal_sk_` key with `releases:write`, never a browser key). `TALARIA_URL` is optional; otherwise the host is `https://ingest-<cell>.newtalaria.com` from the key. After `next build` compiles (Next 15.4+), the plugin:
  1. creates the release with `POST /v1/releases` (plain JSON, commits from `TALARIA_PREVIOUS_COMMIT_SHA..HEAD` when that SHA is set, otherwise the recent commits);
  2. uploads `.next/static` source maps with `POST /v1/source-maps` under their served paths (`_next/static/...`);
  3. deletes the `.map` files and their `sourceMappingURL` comments.

  A failed upload never fails the build.
- **Upload at deploy time instead:** pass `withTalariaConfig(config, { uploadSourceMaps: false, hideSourceMaps: false })` and run `npx talaria-nextjs upload` after the build. It takes the same env variables, and `--keep-maps` keeps the maps.
- **Integration test:** `NORTHLINE_APP=…/demos/northline_web node test/integration/northline.mjs` builds the Northline demo with the plugin. Without `TALARIA_URL`, it checks the calls against a local stub.
