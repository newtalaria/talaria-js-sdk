/**
 * TIS v0.2 credentials (naming-audit §5.1).
 *
 * API keys: `tal_<pk|sk>_<env>_<cell>_<43 base62><6 CRC32 base62>`
 * Monitor tokens: `tal_mon_<cell>_<43 base62><6 CRC32 base62>`
 * Checksum alphabet: `0-9A-Za-z` (CRC32/IEEE, left-padded to 6).
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const API_KEY_RE =
  /^tal_(pk|sk)_(prod|stg|test|dev)_([a-z][a-z0-9]*(?:-[a-z0-9]+)*)_([A-Za-z0-9]{43})([A-Za-z0-9]{6})$/;

const MONITOR_RE =
  /^tal_mon_([a-z][a-z0-9]*(?:-[a-z0-9]+)*)_([A-Za-z0-9]{43})([A-Za-z0-9]{6})$/;

export type KeyClass = 'pk' | 'sk';
export type CredentialKind = KeyClass | 'mon';
export type KeyEnv = 'prod' | 'stg' | 'test' | 'dev';

export interface ParsedCredential {
  ok: true;
  kind: CredentialKind;
  env?: KeyEnv;
  cell: string;
  key: string;
}

export interface InvalidCredential {
  ok: false;
  reason: string;
}

export type CredentialResult = ParsedCredential | InvalidCredential;

/** IEEE CRC32 over a string (each character as a byte; keys are ASCII). */
export function crc32(text: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i);
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 6-character base62 CRC32, alphabet `0-9A-Za-z`, left-padded with `0`. */
export function encodeBase62Crc(value: number): string {
  let n = value >>> 0;
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = ALPHABET[n % 62]! + out;
    n = Math.floor(n / 62);
  }
  return out;
}

export function checksumFor(prefix: string): string {
  return encodeBase62Crc(crc32(prefix));
}

function cellOk(cell: string): boolean {
  return cell.length >= 2 && cell.length <= 24;
}

export function parseCredential(raw: string): CredentialResult {
  const key = raw.trim();
  const api = API_KEY_RE.exec(key);
  if (api) {
    const cell = api[3]!;
    if (!cellOk(cell)) {
      return { ok: false, reason: 'cell must be 2–24 characters' };
    }
    const prefix = key.slice(0, -6);
    if (checksumFor(prefix) !== key.slice(-6)) {
      return { ok: false, reason: 'checksum mismatch' };
    }
    return {
      ok: true,
      kind: api[1] as KeyClass,
      env: api[2] as KeyEnv,
      cell,
      key,
    };
  }
  const mon = MONITOR_RE.exec(key);
  if (mon) {
    const cell = mon[1]!;
    if (!cellOk(cell)) {
      return { ok: false, reason: 'cell must be 2–24 characters' };
    }
    const prefix = key.slice(0, -6);
    if (checksumFor(prefix) !== key.slice(-6)) {
      return { ok: false, reason: 'checksum mismatch' };
    }
    return { ok: true, kind: 'mon', cell, key };
  }
  return {
    ok: false,
    reason: 'does not match tal_pk_, tal_sk_, or tal_mon_ grammar',
  };
}

export function mintCredential(opts: {
  kind: CredentialKind;
  env?: KeyEnv;
  cell: string;
  random: string;
}): string {
  if (!/^[A-Za-z0-9]{43}$/.test(opts.random)) {
    throw new Error('Talaria: credential random body must be 43 base62 characters');
  }
  if (!cellOk(opts.cell) || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(opts.cell)) {
    throw new Error('Talaria: invalid cell id');
  }
  let prefix: string;
  if (opts.kind === 'mon') {
    prefix = `tal_mon_${opts.cell}_${opts.random}`;
  } else {
    if (!opts.env) throw new Error('Talaria: API keys require an environment');
    prefix = `tal_${opts.kind}_${opts.env}_${opts.cell}_${opts.random}`;
  }
  return prefix + checksumFor(prefix);
}

/**
 * Explicit `url` (option or TALARIA_URL) wins. Otherwise derive
 * `https://ingest-<cell>.newtalaria.com`. A `self` cell or a bad key fails fast.
 */
export function resolveIngestUrl(opts: { apiKey: string; url?: string }): string {
  const parsed = parseCredential(opts.apiKey);
  if (!parsed.ok) {
    throw new Error(`Talaria: invalid API key (${parsed.reason})`);
  }
  const explicit = opts.url?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  if (parsed.cell === 'self') {
    throw new Error('Talaria: cell "self" requires TALARIA_URL or the url option');
  }
  return `https://ingest-${parsed.cell}.newtalaria.com`;
}

/** Browser, React, and Next.js client: pk only. */
export function assertBrowserCredential(apiKey: string): ParsedCredential {
  const parsed = parseCredential(apiKey);
  if (!parsed.ok) {
    throw new Error(`@newtalaria/browser: invalid API key (${parsed.reason})`);
  }
  if (parsed.kind !== 'pk') {
    throw new Error(
      '@newtalaria/browser: refusing a secret credential; browser builds accept only tal_pk_ keys',
    );
  }
  return parsed;
}

let warnedPublishable = false;

/** Server SDKs accept sk, warn once on pk, and refuse monitor tokens. */
export function assertServerCredential(
  apiKey: string,
  log: (message: string) => void = console.warn,
): ParsedCredential {
  const parsed = parseCredential(apiKey);
  if (!parsed.ok) {
    throw new Error(`@newtalaria/node: invalid API key (${parsed.reason})`);
  }
  if (parsed.kind === 'mon') {
    throw new Error('@newtalaria/node: monitor tokens are not API keys');
  }
  if (parsed.kind === 'pk' && !warnedPublishable) {
    warnedPublishable = true;
    log(
      '@newtalaria/node: tal_pk_ key cannot call secret routes (releases, flag definitions, monitors)',
    );
  }
  return parsed;
}

export function resetPublishableKeyWarning(): void {
  warnedPublishable = false;
}

/** CI / source-map upload: sk only. */
export function assertReleaseCredential(apiKey: string): ParsedCredential {
  const parsed = parseCredential(apiKey);
  if (!parsed.ok) {
    throw new Error(`Talaria: invalid release key (${parsed.reason})`);
  }
  if (parsed.kind !== 'sk') {
    throw new Error('Talaria: TALARIA_RELEASE_KEY must be a tal_sk_ key');
  }
  return parsed;
}
