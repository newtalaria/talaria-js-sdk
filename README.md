# Talaria JavaScript SDKs

Official npm packages for [Talaria](https://www.newtalaria.com) — exceptions, session replay, and optional APM traces.

| If you are building… | Package | Docs |
| --- | --- | --- |
| A vanilla browser app or script tag | [`@newtalaria/browser`](https://www.npmjs.com/package/@newtalaria/browser) | [Guide](https://www.newtalaria.com/docs/sdk/javascript) |
| A React SPA | [`@newtalaria/react`](https://www.npmjs.com/package/@newtalaria/react) | [Guide](https://www.newtalaria.com/docs/sdk/react) |
| Next.js 14 / 15 / 16 | [`@newtalaria/nextjs`](https://www.npmjs.com/package/@newtalaria/nextjs) | [Guide](https://www.newtalaria.com/docs/sdk/nextjs) |
| A Node.js service | [`@newtalaria/node`](https://www.npmjs.com/package/@newtalaria/node) | [Guide](https://www.newtalaria.com/docs/sdk/node) |

Each adapter depends on shared packages. You do not need to install `@newtalaria/core` yourself.

```bash
npm install @newtalaria/browser
npm install @newtalaria/react
npm install @newtalaria/nextjs
npm install @newtalaria/node
```

Source: [github.com/newtalaria/talaria-js-sdk](https://github.com/newtalaria/talaria-js-sdk) · Dashboard: [one.newtalaria.com](https://one.newtalaria.com)

## What you get

- Batched ingest to `/events/ingestBatch` and (when tracing is on) `/spans/ingestBatch`
- Project API key auth (`X-API-Key`, `tal_live_…`)
- Server-side fingerprinting — the SDK never computes issue groups
- Tracing **off** until you opt in (`enableTracing` / `tracesSampleRate`)
- Browser session replay (rrweb) on `@newtalaria/browser` and the React / Next client surfaces

## Develop

```bash
npm install
npm test
npm run test:browser
npm run build
```

## License

MIT
