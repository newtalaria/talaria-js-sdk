# `@newtalaria/node`

Talaria SDK for Node.js — process errors, incoming HTTP SERVER spans, outgoing `http`/`https` CLIENT spans with W3C `traceparent`, and optional `pg` / `mysql2` / `ioredis` wrappers.

Docs: [Node SDK](https://www.newtalaria.com/docs/sdk/node)

```bash
npm install @newtalaria/node
```

```ts
import http from 'node:http';
import { Talaria, handleHttpRequest } from '@newtalaria/node';

Talaria.init({
  dsn: 'https://api.newtalaria.com',
  apiKey: process.env.TALARIA_API_KEY!,
  environment: process.env.TALARIA_ENVIRONMENT ?? 'production',
  enableTracing: true,
});

http.createServer((req, res) => {
  handleHttpRequest(req, res);
  res.end('ok');
}).listen(3000);
```

Long-lived workers should call `Talaria.resetRequestState()` between jobs.

Building Next.js? Install [`@newtalaria/nextjs`](https://www.npmjs.com/package/@newtalaria/nextjs) instead.
