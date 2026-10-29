# React example

Cloneable Vite + React demo for [`@newtalaria/react`](https://www.newtalaria.com/docs/sdk/react): ErrorBoundary, Profiler, and `reactErrorHandler`.

## Clone and run

```bash
git clone https://github.com/newtalaria/talaria-js-sdk.git
cd talaria-js-sdk/examples/react
cp .env.example .env
```

Put a publishable key (`tal_pk_…`) in `.env` as `VITE_TALARIA_BROWSER_API_KEY`. Omit `VITE_TALARIA_URL` to use `https://ingest-<cell>.newtalaria.com`. For a local server set `VITE_TALARIA_URL=http://127.0.0.1:8080`. Never prefix `TALARIA_API_KEY` or `TALARIA_RELEASE_KEY` with `VITE_`.

**SECURITY**: Never use `VITE_` prefix with `TALARIA_API_KEY` or `TALARIA_RELEASE_KEY` — these are server-only secrets.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5178](http://127.0.0.1:5178). **Throw in render** is caught by `ErrorBoundary`. The other buttons send events directly.
