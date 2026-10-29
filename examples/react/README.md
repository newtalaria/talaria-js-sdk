# React example

Cloneable Vite + React demo for [`@newtalaria/react`](https://www.newtalaria.com/docs/sdk/react): ErrorBoundary, Profiler, and `reactErrorHandler`.

## Clone and run

```bash
git clone https://github.com/newtalaria/talaria-js-sdk.git
cd talaria-js-sdk/examples/react
cp .env.example .env
```

Put a project client key (`tal_prod_…`) in `.env` as `TALARIA_BROWSER_API_KEY`. Local server: `TALARIA_URL=http://127.0.0.1:8080`.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5178](http://127.0.0.1:5178). **Throw in render** is caught by `ErrorBoundary`. The other buttons send events directly.
