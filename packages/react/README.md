# `@newtalaria/react`

Talaria SDK for React. Re-exports [`@newtalaria/browser`](https://www.npmjs.com/package/@newtalaria/browser) and adds an `ErrorBoundary`, React 19 error hooks, a `Profiler`, and optional React Router instrumentation.

Docs: [React SDK](https://www.newtalaria.com/docs/sdk/react)

```bash
npm install @newtalaria/react
```

```tsx
import { createRoot } from 'react-dom/client';
import { Talaria, ErrorBoundary, reactErrorHandler } from '@newtalaria/react';

Talaria.init({
  dsn: 'https://api.newtalaria.com',
  apiKey: 'tal_live_…',
  environment: 'production',
});

const root = createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler(),
});

root.render(
  <ErrorBoundary fallback={<p>Something went wrong.</p>}>
    <App />
  </ErrorBoundary>,
);
```

Building Next.js? Install [`@newtalaria/nextjs`](https://www.npmjs.com/package/@newtalaria/nextjs) instead.
