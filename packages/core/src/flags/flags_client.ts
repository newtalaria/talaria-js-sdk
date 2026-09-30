import type { AnalyticsFacade } from '../analytics.js';
import type { IdentityStore, IdentityStorage } from '../identity.js';
import { keyHash } from '../policy/sdk_policy.js';
import {
  evaluateFlags,
  type EvaluateFlagsInput,
} from '../transport/flags.js';
import type { ServerpodTransport } from '../transport/serverpod.js';
import {
  flagEvaluationFromWire,
  flagEvaluationToCacheJson,
  type FlagEvaluationResult,
} from './flag_evaluation.js';

export const FLAGS_CACHE_KEY_PREFIX = 'talaria.flags.cache.';
export const MAX_STAMP_FLAGS = 20;
export const FEATURE_FLAG_CALLED = '$feature_flag_called';

export interface FlagsClientOptions {
  apiKey: string;
  identity: IdentityStore;
  storage: IdentityStorage;
  getTransport: () => ServerpodTransport | null;
  /** Project policy `flags.enabled`. */
  isEnabled: () => boolean;
  getUserId: () => string | undefined;
  analytics?: AnalyticsFacade | null;
  startTimeoutMs?: number;
  pollIntervalMs?: number;
  onFlagsChanged?: (flags: ReadonlyMap<string, FlagEvaluationResult>) => void;
  logLabel?: string;
}

/**
 * Feature-flag evaluate client (`POST /flags/evaluate`).
 *
 * Typed variation helpers always take a required default. When policy
 * `flags.enabled` is off, network is skipped and defaults are returned.
 * Disk/localStorage cache and a start timeout keep cold starts from blocking.
 */
export class TalariaFlags {
  static readonly cacheKeyPrefix = FLAGS_CACHE_KEY_PREFIX;
  static readonly maxStampFlags = MAX_STAMP_FLAGS;

  startTimeoutMs: number;

  private readonly apiKey: string;
  private readonly identity: IdentityStore;
  private readonly storage: IdentityStorage;
  private readonly getTransport: () => ServerpodTransport | null;
  private readonly isEnabled: () => boolean;
  private readonly getUserId: () => string | undefined;
  private analytics: AnalyticsFacade | null;
  private readonly onFlagsChanged?: (
    flags: ReadonlyMap<string, FlagEvaluationResult>,
  ) => void;
  private readonly logLabel: string;

  private pollIntervalMs: number;
  /** `undefined` = inherit from host `getUserId`; `null` = cleared. */
  private contextUserId: string | null | undefined = undefined;
  private organizationId: string | null = null;
  private attributes: Record<string, string> = {};
  private evaluations = new Map<string, FlagEvaluationResult>();
  private fingerprint: string | null = null;
  private inFlight: Promise<void> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly calledThisSession = new Set<string>();
  private readonly changeListeners = new Set<
    (flags: ReadonlyMap<string, FlagEvaluationResult>) => void
  >();

  constructor(options: FlagsClientOptions) {
    this.apiKey = options.apiKey;
    this.identity = options.identity;
    this.storage = options.storage;
    this.getTransport = options.getTransport;
    this.isEnabled = options.isEnabled;
    this.getUserId = options.getUserId;
    this.analytics = options.analytics ?? null;
    this.onFlagsChanged = options.onFlagsChanged;
    this.logLabel = options.logLabel ?? '@newtalaria/core';
    this.startTimeoutMs = options.startTimeoutMs ?? 3_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 60_000;
    this.loadCacheForCurrentContext();
  }

  setAnalytics(analytics: AnalyticsFacade | null): void {
    this.analytics = analytics;
  }

  /** Last evaluation map (key → result). Empty until cache or network. */
  get evaluatedMap(): ReadonlyMap<string, FlagEvaluationResult> {
    return new Map(this.evaluations);
  }

  /** Compact stamp map: `flag key → variationKey` (capped for outbound tags). */
  get activeFlags(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, result] of this.evaluations) {
      if (Object.keys(out).length >= MAX_STAMP_FLAGS) break;
      if (!result.variationKey) continue;
      out[key] = result.variationKey;
    }
    return out;
  }

  /** Tags suitable for events / span attributes: `flag.<key> → variation`. */
  stampTags(max = MAX_STAMP_FLAGS): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, variation] of Object.entries(this.activeFlags)) {
      if (Object.keys(out).length >= max) break;
      out[`flag.${key}`] = variation;
    }
    return out;
  }

  onChange(
    listener: (flags: ReadonlyMap<string, FlagEvaluationResult>) => void,
  ): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /**
   * Update targeting context and reload evaluations.
   * Pass `userId: null` / `organizationId: null` to clear those fields.
   */
  async setContext(args: {
    userId?: string | null;
    organizationId?: string | null;
    attributes?: Record<string, string>;
  }): Promise<void> {
    if ('userId' in args) {
      const raw = args.userId;
      this.contextUserId =
        raw != null && String(raw).trim() !== '' ? String(raw).trim() : null;
    }
    if ('organizationId' in args) {
      const raw = args.organizationId;
      this.organizationId =
        raw != null && String(raw).trim() !== '' ? String(raw).trim() : null;
    }
    if (args.attributes != null) {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(args.attributes)) {
        next[k] = String(v);
      }
      this.attributes = next;
    }
    this.loadCacheForCurrentContext();
    await this.reload();
  }

  /** Force a network evaluate when flags are enabled. */
  async reload(): Promise<void> {
    if (this.closed || !this.isEnabled()) return;
    await this.refresh({ wait: true });
  }

  /** Policy / TTL hook after `getConfig`. */
  onPolicyUpdated(opts?: { pollIntervalMs?: number }): void {
    if (opts?.pollIntervalMs != null) {
      this.pollIntervalMs = opts.pollIntervalMs;
    }
    if (!this.isEnabled()) {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      return;
    }
    this.loadCacheForCurrentContext();
    void this.refresh({ wait: false });
    this.schedulePoll();
  }

  async boolVariation(key: string, defaultValue: boolean): Promise<boolean> {
    const result = await this.resolve(key);
    if (!result) return defaultValue;
    await this.maybeTrackCalled(key, result);
    const value = result.value;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === '1') return true;
      if (lower === 'false' || lower === '0') return false;
    }
    return defaultValue;
  }

  async stringVariation(key: string, defaultValue: string): Promise<string> {
    const result = await this.resolve(key);
    if (!result) return defaultValue;
    await this.maybeTrackCalled(key, result);
    const value = result.value;
    if (value == null) return defaultValue;
    if (typeof value === 'string') return value;
    return String(value);
  }

  async jsonVariation(key: string, defaultValue: unknown): Promise<unknown> {
    const result = await this.resolve(key);
    if (!result) return defaultValue;
    await this.maybeTrackCalled(key, result);
    return result.value ?? defaultValue;
  }

  async evaluation(key: string): Promise<FlagEvaluationResult | undefined> {
    return this.resolve(key);
  }

  close(): void {
    this.closed = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.changeListeners.clear();
  }

  private async resolve(
    key: string,
  ): Promise<FlagEvaluationResult | undefined> {
    const trimmed = key.trim();
    if (!trimmed) return undefined;
    if (!this.isEnabled()) return undefined;

    const cached = this.evaluations.get(trimmed);
    if (cached) return cached;

    if (this.inFlight != null || this.evaluations.size === 0) {
      await this.ensureStarted();
    }
    return this.evaluations.get(trimmed);
  }

  private async ensureStarted(): Promise<void> {
    if (this.closed || !this.isEnabled()) return;
    const existing = this.inFlight;
    if (existing) {
      try {
        await withTimeout(existing, this.startTimeoutMs);
      } catch {
        /* start timeout */
      }
      return;
    }
    const started = this.refresh({ wait: true });
    try {
      await withTimeout(started, this.startTimeoutMs);
    } catch {
      /* start timeout */
    }
  }

  private async refresh(opts: { wait: boolean }): Promise<void> {
    if (this.closed || !this.isEnabled()) return;

    if (this.inFlight) {
      if (opts.wait) await this.inFlight;
      return;
    }

    const transport = this.getTransport();
    if (!transport) return;

    let resolveInFlight!: () => void;
    this.inFlight = new Promise<void>((resolve) => {
      resolveInFlight = resolve;
    });

    try {
      const input: EvaluateFlagsInput = {
        anonymousId: this.identity.getAnonymousId() || undefined,
      };
      const userId = this.effectiveUserId();
      if (userId) input.userId = userId;
      if (this.organizationId) input.organizationId = this.organizationId;
      if (Object.keys(this.attributes).length > 0) {
        input.attributes = this.attributes;
      }

      const raw = await evaluateFlags(transport, input);
      const list = parseEvaluations(raw);
      const next = new Map<string, FlagEvaluationResult>();
      for (const item of list) {
        if (item.key) next.set(item.key, item);
      }
      this.evaluations = next;
      this.fingerprint = this.contextFingerprint();
      this.persistCache();
      const snapshot = this.evaluatedMap;
      for (const listener of this.changeListeners) {
        try {
          listener(snapshot);
        } catch {
          /* ignore */
        }
      }
      this.onFlagsChanged?.(snapshot);
    } catch (error) {
      console.warn(`${this.logLabel}: flags evaluate failed`, error);
    } finally {
      resolveInFlight();
      this.inFlight = null;
    }
  }

  private schedulePoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.closed || !this.isEnabled()) return;
    const wait = Math.min(
      60 * 60 * 1000,
      Math.max(15 * 1000, Math.floor(this.pollIntervalMs)),
    );
    this.pollTimer = setTimeout(() => {
      void (async () => {
        await this.refresh({ wait: false });
        this.schedulePoll();
      })();
    }, wait);
  }

  private effectiveUserId(): string | undefined {
    if (this.contextUserId != null && this.contextUserId !== '') {
      return this.contextUserId;
    }
    // Explicit clear via setContext({ userId: null }).
    if (this.contextUserId === null) return undefined;
    const fromGetter = this.getUserId()?.trim();
    return fromGetter || undefined;
  }

  private contextFingerprint(): string {
    const attrs = Object.entries(this.attributes).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const attrPart = attrs.map(([k, v]) => `${k}=${v}`).join('&');
    return [
      this.identity.getAnonymousId() ?? '',
      this.effectiveUserId() ?? '',
      this.organizationId ?? '',
      attrPart,
    ].join('|');
  }

  private cacheStorageKey(): string {
    return `${FLAGS_CACHE_KEY_PREFIX}${keyHash(this.apiKey)}`;
  }

  private loadCacheForCurrentContext(): void {
    const raw = this.storage.getItem(this.cacheStorageKey());
    if (!raw) return;
    try {
      const decoded = JSON.parse(raw) as Record<string, unknown>;
      const fingerprint =
        typeof decoded.fingerprint === 'string' ? decoded.fingerprint : null;
      if (fingerprint !== this.contextFingerprint()) return;
      const list = decoded.evaluations;
      if (!Array.isArray(list)) return;
      const next = new Map<string, FlagEvaluationResult>();
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const result = flagEvaluationFromWire(item as Record<string, unknown>);
        if (!result.key) continue;
        next.set(result.key, result);
      }
      this.evaluations = next;
      this.fingerprint = fingerprint;
    } catch {
      /* ignore corrupt cache */
    }
  }

  private persistCache(): void {
    const fingerprint = this.fingerprint ?? this.contextFingerprint();
    const payload = JSON.stringify({
      fingerprint,
      evaluations: [...this.evaluations.values()].map(flagEvaluationToCacheJson),
    });
    try {
      this.storage.setItem(this.cacheStorageKey(), payload);
    } catch {
      /* quota / private mode */
    }
  }

  private async maybeTrackCalled(
    key: string,
    result: FlagEvaluationResult,
  ): Promise<void> {
    if (this.calledThisSession.has(key)) return;
    this.calledThisSession.add(key);
    const analytics = this.analytics;
    if (!analytics || !analytics.isEnabled()) return;
    analytics.track(FEATURE_FLAG_CALLED, {
      $feature_flag: key,
      $feature_flag_response: result.variationKey,
      version: result.version,
      ...(result.reason != null ? { reason: result.reason } : {}),
    });
  }
}

function parseEvaluations(
  raw: Record<string, unknown>,
): FlagEvaluationResult[] {
  const list = raw.evaluations ?? raw.flags;
  if (!Array.isArray(list)) return [];
  const out: FlagEvaluationResult[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const result = flagEvaluationFromWire(item as Record<string, unknown>);
    if (!result.key) continue;
    out.push(result);
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
