# Example apps

Each app installs the published npm packages (`@newtalaria/browser`, `@newtalaria/react`, `@newtalaria/nextjs`).

```bash
git clone https://github.com/newtalaria/talaria-js-sdk.git
cd talaria-js-sdk/examples/<vanilla|react|next>
cp .env.example .env
# paste a project API key (Project settings → Client keys)
npm install
npm run dev
```

| App | Package | Path |
| --- | --- | --- |
| Vanilla browser (Vite + script tag) | `@newtalaria/browser` | [`examples/vanilla`](./vanilla) |
| React SPA (Vite) | `@newtalaria/react` | [`examples/react`](./react) |
| Next.js 15 App Router | `@newtalaria/nextjs` | [`examples/next`](./next) |
