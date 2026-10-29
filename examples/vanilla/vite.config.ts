import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: { port: 5177 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        scriptTag: resolve(root, 'script-tag.html'),
      },
    },
  },
});
