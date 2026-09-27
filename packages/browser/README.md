# `@newtalaria/browser`

Official browser SDK for [Talaria](https://www.newtalaria.com).

**Docs:** [JavaScript SDK](https://www.newtalaria.com/docs/sdk/javascript) · [Project configuration](https://www.newtalaria.com/docs/configuration)

## Install

```bash
npm install @newtalaria/browser
```

```ts
import { Talaria } from '@newtalaria/browser';

Talaria.init({
  dsn: 'https://ingest.newtalaria.com',
  apiKey: 'tal_live_…',
  environment: 'production',
  release: '1.4.2',
  minLevel: 'warning',
});
```

Tracing, analytics, heatmaps, and session replay follow Project settings.

## License

MIT
