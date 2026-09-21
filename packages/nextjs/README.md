# `@newtalaria/nextjs`

Talaria SDK for Next.js 14–16. Install this package only — it pulls React (client) and Node (server).

Docs: [Next.js SDK](https://www.newtalaria.com/docs/sdk/nextjs)

```bash
npm install @newtalaria/nextjs
```

Use **disjoint entrypoints** so the App Router never bundles Node `http` into the client:

```ts
// instrumentation-client.ts
import { initClient } from '@newtalaria/nextjs/client';

initClient({
  dsn: process.env.NEXT_PUBLIC_TALARIA_DSN!,
  apiKey: process.env.NEXT_PUBLIC_TALARIA_API_KEY!,
  environment: process.env.NEXT_PUBLIC_TALARIA_ENVIRONMENT ?? 'production',
  replaysOnErrorSampleRate: 1,
});
```

```ts
// talaria.server.config.ts
import { initServer } from '@newtalaria/nextjs/server';

initServer({
  dsn: process.env.TALARIA_DSN!,
  apiKey: process.env.TALARIA_API_KEY!,
  environment: process.env.TALARIA_ENVIRONMENT ?? 'production',
  enableTracing: true,
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
