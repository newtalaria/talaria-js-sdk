import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

// SECURITY: Never expose TALARIA_API_KEY or TALARIA_RELEASE_KEY to the browser.
// Only TALARIA_URL and TALARIA_BROWSER_API_KEY are safe for client bundles.
export default defineConfig({
  server: { port: 5177 },
  define: {
    'import.meta.env.TALARIA_URL': JSON.stringify(process.env.TALARIA_URL ?? ''),
    'import.meta.env.TALARIA_BROWSER_API_KEY': JSON.stringify(process.env.TALARIA_BROWSER_API_KEY ?? ''),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        scriptTag: resolve(root, 'script-tag.html'),
      },
    },
  },
});
