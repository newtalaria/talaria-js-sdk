import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTalariaConfig } from '@newtalaria/nextjs/config';

const dir = dirname(fileURLToPath(import.meta.url));

export default withTalariaConfig({
  outputFileTracingRoot: dir,
});
