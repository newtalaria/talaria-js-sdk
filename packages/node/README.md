# `@newtalaria/node`

Talaria SDK for Node.js — process errors, incoming HTTP SERVER spans, outgoing `http`/`https` CLIENT spans with W3C `traceparent`, and optional `pg` / `mysql2` / `ioredis` / `@duckdb/node-api` wrappers. Prisma, Drizzle, and Kysely record SQL when you wrap the pool they use. Knex and Sequelize open their own connections; the instrumentation docs show the query events and hooks for those.

Docs: [Node SDK](https://www.newtalaria.com/docs/sdk/node)

```bash
npm install @newtalaria/node
```

```ts
import http from 'node:http';
import { Talaria, handleHttpRequest } from '@newtalaria/node';

Talaria.init({
  dsn: 'https://ingest.newtalaria.com',
  apiKey: process.env.TALARIA_API_KEY!,
  remoteConfig: true,
});

http.createServer((req, res) => {
  handleHttpRequest(req, res);
  res.end('ok');
}).listen(3000);
```

The API key decides the environment. Long-lived workers should call `Talaria.resetRequestState()` between jobs.

Building Next.js? Install [`@newtalaria/nextjs`](https://www.npmjs.com/package/@newtalaria/nextjs) instead.
