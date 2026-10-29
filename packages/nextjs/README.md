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
  dsn: 'https://ingest.newtalaria.com',
  apiKey: process.env.NEXT_PUBLIC_TALARIA_API_KEY!,
});
```

```ts
// talaria.server.config.ts
import { initServer } from '@newtalaria/nextjs/server';

initServer({
  dsn: 'https://ingest.newtalaria.com',
  apiKey: process.env.TALARIA_API_KEY!,
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
- **Upload at build time:** set `TALARIA_RELEASE_KEY` (a `releases:write` key, never the browser key) and `TALARIA_URL`. The key names the project, so `TALARIA_PROJECT_ID` is optional. After `next build` compiles (Next 15.4+), the plugin:
  1. creates the release with its commits through `releases/setCommits`. The range is the previous release's commit up to HEAD (at most 250 commits); the server reports the previous commit, or `TALARIA_PREVIOUS_COMMIT_SHA` sets it;
  2. uploads `.next/static` source maps under their served paths (`_next/static/...`);
  3. checks the upload with `sourceMaps/list`;
  4. deletes the `.map` files and their `sourceMappingURL` comments.

  A failed upload never fails the build.
- **Upload at deploy time instead:** pass `withTalariaConfig(config, { uploadSourceMaps: false, hideSourceMaps: false })` and run `npx talaria-nextjs upload` after the build. It takes the same env variables, and `--keep-maps` keeps the maps.
- **Integration test:** `NORTHLINE_APP=…/demos/northline_web node test/integration/northline.mjs` builds the Northline demo with the plugin. Without `TALARIA_URL`, it checks the calls against a local stub.
