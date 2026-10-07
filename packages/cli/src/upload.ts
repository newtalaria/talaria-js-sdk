import { randomUUID } from 'node:crypto';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ServerpodTransport, resolveReleaseIdentity } from '@newtalaria/core';

const SEGMENT = /^[A-Za-z0-9._~+-]+$/;
const SAFE_DEBUG_ID = /^[A-Za-z0-9._~+-]{1,80}$/;
const DEBUG_COMMENT = /\/\/# debugId=([^\s]+)/;
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
  silverstripeCombineFiles: boolean;
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
  if (parsed.silverstripeCombineFiles) {
    log('Silverstripe combine: shifted generated lines by the header comment');
  }
  const transport = new ServerpodTransport({ baseUrl: url, apiKey });
  let failed = 0;
  for (const file of maps) {
    const prepared = await prepareArtifact(root, file);
    const payload = parsed.silverstripeCombineFiles
      ? shiftForSilverstripeCombine(prepared.json)
      : prepared.json;
    const fileName = prepared.fileName;
    log(fileName);
    if (!fileNameOk(fileName)) {
      error(
        `${fileName}: file name must be a served artifact path, such as static/js/main.js`,
      );
      failed += 1;
      continue;
    }
    const raw = Buffer.from(payload, 'utf8');
    const debugId = prepared.debugId;
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
  let silverstripeCombineFiles = false;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--release') {
      release = requireValue(args, ++i, '--release');
    } else if (arg === '--url') {
      url = requireValue(args, ++i, '--url');
    } else if (arg === '--api-key') {
      apiKey = requireValue(args, ++i, '--api-key');
    } else if (arg === '--silverstripe-combine-files') {
      silverstripeCombineFiles = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length > 1) {
    throw new Error('Pass one directory of built source maps');
  }
  return {
    path: positionals[0] ?? '.',
    release,
    url,
    apiKey,
    silverstripeCombineFiles,
  };
}

/** One empty generated line, matching Silverstripe's header before the first combined file. */
function shiftForSilverstripeCombine(jsonText: string): string {
  const parsed = parseMap(jsonText);
  if (!parsed) return jsonText;
  const mappings = parsed.mappings;
  if (typeof mappings !== 'string' || mappings.length === 0) return jsonText;
  parsed.mappings = `;${mappings}`;
  return `${JSON.stringify(parsed)}\n`;
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

function fileNameOk(name: string): boolean {
  if (!name || name.length > 200 || name.includes('\\')) return false;
  const parts = name.split('/');
  return (
    parts.length > 0 &&
    parts.every((part) => part !== '.' && part !== '..' && SEGMENT.test(part))
  );
}

interface PreparedArtifact {
  fileName: string;
  debugId?: string;
  json: string;
}

async function prepareArtifact(
  root: string,
  mapPath: string,
): Promise<PreparedArtifact> {
  const jsonText = await readFile(mapPath, 'utf8');
  const parsed = parseMap(jsonText);
  const jsPath = mapPath.slice(0, -'.map'.length);
  const sibling =
    jsPath.endsWith('.js') && jsPath !== mapPath && (await exists(jsPath));
  if (!sibling || !parsed) {
    return {
      fileName: path.basename(mapPath).replace(/\.map$/, ''),
      debugId: debugIdOf(parsed),
      json: jsonText,
    };
  }

  let js = await readFile(jsPath, 'utf8');
  const fromJs = safeDebugId(js.match(DEBUG_COMMENT)?.[1]);
  const fromMap = safeDebugId(debugIdOf(parsed));
  const debugId = fromJs || fromMap || randomUUID();
  if (!fromJs) {
    const body = js.endsWith('\n') ? js : `${js}\n`;
    js = `${body}${debugIdSnippet(debugId)}\n`;
    await writeFile(jsPath, js);
  }
  let json = jsonText;
  if (fromMap !== debugId) {
    parsed.debugId = debugId;
    json = `${JSON.stringify(parsed)}\n`;
    await writeFile(mapPath, json);
  }
  return {
    fileName: path.relative(root, jsPath).split(path.sep).join('/'),
    debugId,
    json,
  };
}

function debugIdSnippet(debugId: string): string {
  return `;try{(function(id){var g=globalThis.__talariaDebugIds||(globalThis.__talariaDebugIds={});function put(url){if(!url)return;g[url]=id;var clean=String(url).split("?")[0].split("#")[0].replace(/:\\d+:\\d+$/,"");g[clean]=id;}try{if(typeof document!=="undefined"&&document.currentScript&&document.currentScript.src)put(document.currentScript.src);}catch(e){}try{var stack=(new Error).stack||"";var matches=stack.match(/https?:\\/\\/[^)\\s]+/g)||[];for(var i=0;i<matches.length;i++)put(matches[i]);}catch(e){}})("${debugId}")}catch(e){}\n//# debugId=${debugId}`;
}

function parseMap(jsonText: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function safeDebugId(value: string | undefined): string | undefined {
  if (!value || !SAFE_DEBUG_ID.test(value)) return undefined;
  return value;
}

function debugIdOf(parsed: Record<string, unknown> | undefined): string | undefined {
  if (!parsed) return undefined;
  const value = parsed.debugId ?? parsed.debug_id;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
