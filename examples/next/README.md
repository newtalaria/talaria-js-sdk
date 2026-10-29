# Next.js example

Cloneable Next.js 15 App Router demo for [`@newtalaria/nextjs`](https://www.newtalaria.com/docs/sdk/nextjs): client instrumentation, server/edge init, a Server Action, and a Route Handler.

## Clone and run

```bash
git clone https://github.com/newtalaria/talaria-js-sdk.git
cd talaria-js-sdk/examples/next
cp .env.example .env.local
```

Put a project client key (`tal_prod_…`) in `.env.local` as `NEXT_PUBLIC_TALARIA_BROWSER_API_KEY` (browser) and `TALARIA_API_KEY` (server). Local server: set `NEXT_PUBLIC_TALARIA_URL=http://127.0.0.1:8080` and `TALARIA_URL=http://127.0.0.1:8080`.

**SECURITY**: Never use `NEXT_PUBLIC_` prefix with `TALARIA_API_KEY` or `TALARIA_RELEASE_KEY` — these are server-only secrets.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3010](http://127.0.0.1:3010).

| Control | What it hits |
| --- | --- |
| Throw in the browser | Client exception (`instrumentation-client.ts`) |
| Throw in a Server Action | `withServerAction` |
| Throw in a Route Handler | `withRouteHandler` at `/api/boom` |
