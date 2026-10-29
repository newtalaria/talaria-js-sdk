# Vanilla JavaScript example

Cloneable demo for [`@newtalaria/browser`](https://www.newtalaria.com/docs/sdk/javascript): a Vite app plus a no-bundler script-tag page.

## Clone and run

```bash
git clone https://github.com/newtalaria/talaria-js-sdk.git
cd talaria-js-sdk/examples/vanilla
cp .env.example .env
```

Put a publishable key (`tal_pk_…`) in `.env` as `VITE_TALARIA_BROWSER_API_KEY`. Omit `VITE_TALARIA_URL` to use `https://ingest-<cell>.newtalaria.com`. For a local server set `VITE_TALARIA_URL=http://127.0.0.1:8080`. Never prefix `TALARIA_API_KEY` or `TALARIA_RELEASE_KEY` with `VITE_`.

**SECURITY**: Never use `VITE_` prefix with `TALARIA_API_KEY` or `TALARIA_RELEASE_KEY` — these are server-only secrets.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5177](http://127.0.0.1:5177). Use **Capture exception** / **Capture message**, then check [one.newtalaria.com](https://one.newtalaria.com) (or your local dashboard).

The script-tag page is [http://127.0.0.1:5177/script-tag.html](http://127.0.0.1:5177/script-tag.html). It loads the IIFE from jsDelivr. Pass `?apiKey=tal_pk_…` or set `localStorage.TALARIA_BROWSER_API_KEY`. Omit `url` to use the host derived from the key.
