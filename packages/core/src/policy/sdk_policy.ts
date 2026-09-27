import { IngestError } from '../transport/ingest_error.js';
import type { ServerpodTransport } from '../transport/serverpod.js';

export const SDK_CONFIG_SCHEMA = 1;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 60 * 60;
const TOMBSTONE_MS = 24 * 60 * 60 * 1000;

export interface SdkMeterPolicy {
  state: 'accepting' | 'paused';
  retryAfterSeconds?: number;
}

export interface SdkConfigDocument {
  schemaVersion: number;
  revision: string;
  unchanged?: boolean;
  active?: boolean;
  ttlSeconds?: number;
  events?: { sampleRate?: number | null };
  tracing?: { enabled?: boolean; tracesSampleRate?: number };
  analytics?: { enabled?: boolean };
  heatmaps?: { enabled?: boolean };
  replay?: {
    enabled?: boolean;
    sessionSampleRate?: number;
    errorSampleRate?: number;
    maxDurationMs?: number;
    maskAllInputs?: boolean;
    blockSelectors?: string[];
  };
  ingest?: {
    events?: SdkMeterPolicy;
    transactions?: SdkMeterPolicy;
    replays?: SdkMeterPolicy;
    analytics?: SdkMeterPolicy;
  };
}

export interface SdkPolicyCacheEntry {
  kind: 'document' | 'tombstone';
  fetchedAt: number;
  quietUntil?: number;
  document?: SdkConfigDocument;
}

export interface SdkPolicyStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function keyHash(apiKey: string): string {
  let hash = 2166136261;
  for (let i = 0; i < apiKey.length; i++) {
    hash ^= apiKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function cacheKey(apiKey: string): string {
  return `talaria.sdkConfig.${keyHash(apiKey)}`;
}

export function clampTtlSeconds(ttl: number | undefined): number {
  if (ttl === undefined || Number.isNaN(ttl)) return 300;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(ttl)));
}

export function readPolicyCache(
  storage: SdkPolicyStorage | null,
  apiKey: string,
): SdkPolicyCacheEntry | null {
  if (!storage) return null;
  const raw = storage.get(cacheKey(apiKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SdkPolicyCacheEntry;
    if (parsed.kind !== 'document' && parsed.kind !== 'tombstone') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePolicyCache(
  storage: SdkPolicyStorage | null,
  apiKey: string,
  entry: SdkPolicyCacheEntry,
): void {
  storage?.set(cacheKey(apiKey), JSON.stringify(entry));
}

export function clearPolicyCache(
  storage: SdkPolicyStorage | null,
  apiKey: string,
): void {
  storage?.remove(cacheKey(apiKey));
}

export function documentIsFresh(entry: SdkPolicyCacheEntry, now: number): boolean {
  if (entry.kind !== 'document' || !entry.document) return false;
  const ttl = clampTtlSeconds(entry.document.ttlSeconds) * 1000;
  return now - entry.fetchedAt < ttl;
}

export function tombstoneIsQuiet(entry: SdkPolicyCacheEntry, now: number): boolean {
  return entry.kind === 'tombstone' && (entry.quietUntil ?? 0) > now;
}

export function isUsableDocument(document: SdkConfigDocument): boolean {
  return document.schemaVersion === SDK_CONFIG_SCHEMA && typeof document.revision === 'string';
}

export function parseSdkConfig(body: unknown): SdkConfigDocument | null {
  if (!body || typeof body !== 'object') return null;
  const map = body as SdkConfigDocument;
  if (!isUsableDocument(map)) return null;
  return map;
}

export async function fetchSdkConfig(
  transport: ServerpodTransport,
  args: {
    sdkName: string;
    sdkVersion: string;
    platform: string;
    revision?: string;
  },
): Promise<SdkConfigDocument> {
  const input: Record<string, unknown> = {
    __className__: 'GetSdkConfigInput',
    schemaVersion: SDK_CONFIG_SCHEMA,
    sdkName: args.sdkName,
    sdkVersion: args.sdkVersion,
    platform: args.platform,
  };
  if (args.revision) input.revision = args.revision;
  const response = await transport.call('sdk', 'getConfig', { input }, {
    signal: AbortSignal.timeout(2000),
  });
  const document = parseSdkConfig(response);
  if (!document) {
    throw new Error('Talaria sdk/getConfig returned an unreadable document');
  }
  return document;
}

export async function reportDiscards(
  transport: ServerpodTransport,
  discards: Array<{ signal: string; reason: string; count: number }>,
): Promise<void> {
  if (discards.length === 0) return;
  await transport.call('sdk', 'reportDiscards', {
    input: {
      __className__: 'ReportSdkDiscardsInput',
      discards: discards.map((row) => ({
        __className__: 'SdkDiscardCountInput',
        signal: row.signal,
        reason: row.reason,
        count: row.count,
      })),
    },
  });
}

function asIngestError(error: unknown): IngestError {
  if (error instanceof IngestError) return error;
  return IngestError.fromUnknown(error);
}

export function tombstoneFromError(error: unknown, now: number): SdkPolicyCacheEntry | null {
  const parsed = asIngestError(error);
  if (!parsed.isGlobalCredentialFailure) return null;
  return {
    kind: 'tombstone',
    fetchedAt: now,
    quietUntil: now + TOMBSTONE_MS,
  };
}

/** Disabled-signal messages stop that signal only. */
export function disabledSignal(
  error: unknown,
): 'events' | 'spans' | 'replay' | 'analytics' | null {
  const parsed = asIngestError(error);
  if (!parsed.isPermanent || parsed.isGlobalCredentialFailure || parsed.isScopeOnly) {
    return null;
  }
  const message = (parsed.message ?? '').toLowerCase();
  if (message.includes('tracing is disabled') || message.includes('performance is disabled')) {
    return 'spans';
  }
  if (message.includes('analytics is disabled')) return 'analytics';
  if (message.includes('session replay is disabled')) return 'replay';
  return null;
}
