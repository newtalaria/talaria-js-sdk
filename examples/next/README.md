# Next.js example

Cloneable Next.js 15 App Router demo for [`@newtalaria/nextjs`](https://www.newtalaria.com/docs/sdk/nextjs): client instrumentation, server/edge init, a Server Action, and a Route Handler.

## Clone and run

```bash
git clone https://github.com/newtalaria/talaria-js-sdk.git
cd talaria-js-sdk/examples/next
cp .env.example .env.local
```

Put a publishable key (`tal_pk_…`) in `.env.local` as `NEXT_PUBLIC_TALARIA_BROWSER_API_KEY` and a secret key (`tal_sk_…`) as `TALARIA_API_KEY`. Omit the URL variables to use `https://ingest-<cell>.newtalaria.com`. For a local server set `NEXT_PUBLIC_TALARIA_URL` and `TALARIA_URL` to `http://127.0.0.1:8080`. Never prefix `TALARIA_API_KEY` or `TALARIA_RELEASE_KEY` with `NEXT_PUBLIC_`.

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
