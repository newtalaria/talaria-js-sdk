import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ServerpodTransport, resolveReleaseIdentity } from '@newtalaria/core';

const FILE_NAME = /^[A-Za-z0-9._~+-]+$/;
const LOCAL_URL = 'http://localhost:8080';

export interface UploadSourceMapsOptions {
  cwd: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

interface ParsedArgs {
  path: string;
  release?: string;
  url?: string;
  apiKey?: string;
}

export async function uploadSourceMaps(
  options: UploadSourceMapsOptions,
): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line));
  const error = options.error ?? ((line: string) => console.error(line));
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(options.argv);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const url = parsed.url || options.env.TALARIA_BASE_URL || LOCAL_URL;
  const release =
    resolveReleaseIdentity({
      release: parsed.release,
      env: options.env,
    }).release || 'local';
  const apiKey =
    parsed.apiKey ||
    options.env.TALARIA_RELEASE_KEY ||
    options.env.TALARIA_API_KEY;
  if (!apiKey) {
    error(
      'Set TALARIA_RELEASE_KEY to a releases:write key, or pass --api-key.',
    );
    return 1;
  }

  const root = path.resolve(options.cwd, parsed.path);
  const maps = await collectMaps(root);
  if (maps.length === 0) {
    error(`No JavaScript source maps under ${root}`);
    return 1;
  }

  log(`${url} release ${release}`);
  const transport = new ServerpodTransport({ baseUrl: url, apiKey });
  let failed = 0;
  for (const file of maps) {
    const fileName = path.basename(file).replace(/\.map$/, '');
    log(fileName);
    if (!FILE_NAME.test(fileName) || fileName.length > 200) {
      error(
        `${fileName}: file name must be the minified basename, such as main.js`,
      );
      failed += 1;
      continue;
    }
    const raw = await readFile(file);
    const debugId = readDebugId(raw);
    const gzipBytes = `decode('${gzipSync(raw).toString('base64')}', 'base64')`;
    const input: Record<string, unknown> = {
      __className__: 'UploadSourceMapInput',
      release,
      fileName,
      gzipBytes,
    };
    if (debugId) input.debugId = debugId;
    try {
      const result = await transport.call('sourceMaps', 'upload', { input });
      const id =
        result && typeof result === 'object' && 'id' in result
          ? String((result as { id: unknown }).id)
          : '';
      log(id ? `${fileName} ${id}` : fileName);
    } catch (err) {
      failed += 1;
      error(`${fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  if (args[0] === 'sourcemaps') args.shift();
  if (args[0] !== 'upload') {
    throw new Error('Usage: talaria sourcemaps upload [path]');
  }
  args.shift();
  let release: string | undefined;
  let url: string | undefined;
  let apiKey: string | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--release') {
      release = requireValue(args, ++i, '--release');
    } else if (arg === '--url') {
      url = requireValue(args, ++i, '--url');
    } else if (arg === '--api-key') {
      apiKey = requireValue(args, ++i, '--api-key');
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length > 1) {
    throw new Error('Pass one directory of built source maps');
  }
  return { path: positionals[0] ?? '.', release, url, apiKey };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

async function collectMaps(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, out);
  out.sort();
  return out;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js.map')) {
      out.push(full);
    }
  }
}

function readDebugId(raw: Buffer): string | undefined {
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const debugId = (parsed as { debugId?: unknown }).debugId;
    if (typeof debugId !== 'string') return undefined;
    const trimmed = debugId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
