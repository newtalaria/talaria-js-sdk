import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTalariaConfig } from '@newtalaria/nextjs/config';

const dir = dirname(fileURLToPath(import.meta.url));

export default withTalariaConfig({
  outputFileTracingRoot: dir,
  env: {
    TALARIA_URL: process.env.TALARIA_URL,
    TALARIA_BROWSER_API_KEY: process.env.TALARIA_BROWSER_API_KEY,
  },
});
