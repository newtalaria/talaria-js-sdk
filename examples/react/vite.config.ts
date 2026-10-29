import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// SECURITY: Never expose TALARIA_API_KEY or TALARIA_RELEASE_KEY to the browser.
// Only TALARIA_URL and TALARIA_BROWSER_API_KEY are safe for client bundles.
export default defineConfig({
  plugins: [react()],
  server: { port: 5178 },
  define: {
    'import.meta.env.TALARIA_URL': JSON.stringify(process.env.TALARIA_URL ?? ''),
    'import.meta.env.TALARIA_BROWSER_API_KEY': JSON.stringify(process.env.TALARIA_BROWSER_API_KEY ?? ''),
  },
});
