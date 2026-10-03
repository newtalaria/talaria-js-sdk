#!/usr/bin/env node
import { uploadSourceMaps } from './upload.js';

const code = await uploadSourceMaps({
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  env: process.env,
});
process.exit(code);
