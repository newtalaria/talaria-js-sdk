import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTalariaConfig } from '@newtalaria/nextjs/config';

const dir = dirname(fileURLToPath(import.meta.url));

// SECURITY: Never expose TALARIA_API_KEY or TALARIA_RELEASE_KEY to the browser.
// Only TALARIA_URL and TALARIA_BROWSER_API_KEY are safe for client bundles.
export default withTalariaConfig({
  outputFileTracingRoot: dir,
  env: {
    // Explicitly list browser-safe env vars only:
    TALARIA_URL: process.env.TALARIA_URL || '',
    TALARIA_BROWSER_API_KEY: process.env.TALARIA_BROWSER_API_KEY || '',
  },
});
