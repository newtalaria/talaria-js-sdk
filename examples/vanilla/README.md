# Vanilla JavaScript example

Cloneable demo for [`@newtalaria/browser`](https://www.newtalaria.com/docs/sdk/javascript): a Vite app plus a no-bundler script-tag page.

## Clone and run

```bash
git clone https://github.com/newtalaria/talaria-js-sdk.git
cd talaria-js-sdk/examples/vanilla
cp .env.example .env
```

Put a project client key (`tal_live_…`) in `.env` as `VITE_TALARIA_API_KEY`. Local server: `VITE_TALARIA_DSN=http://127.0.0.1:8080`.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5177](http://127.0.0.1:5177). Use **Capture exception** / **Capture message**, then check [one.newtalaria.com](https://one.newtalaria.com) (or your local dashboard).

The script-tag page is [http://127.0.0.1:5177/script-tag.html](http://127.0.0.1:5177/script-tag.html). It loads the IIFE from jsDelivr. Pass `?apiKey=tal_live_…` or set `localStorage.TALARIA_API_KEY`.
