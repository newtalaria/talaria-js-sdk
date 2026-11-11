import type { IngestError } from './ingest_error.js';

function keyHash(apiKey: string): string {
  let hash = 2166136261;
  for (let i = 0; i < apiKey.length; i++) {
    hash ^= apiKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/** Floor from ADR-86 / IB3: never probe sooner than 15 minutes. */
export const INGEST_BLOCK_MIN_RETRY_SECONDS = 15 * 60;
/** Ceiling: never wait more than 24 hours between checks. */
export const INGEST_BLOCK_MAX_RETRY_SECONDS = 24 * 60 * 60;

export type IngestBlockState = 'ok' | 'blocked';

export interface IngestBlockStatus {
  state: IngestBlockState;
  reason?: string;
  retryAfterSeconds?: number;
}

export function clampIngestBlockRetry(seconds: number | null | undefined): number {
  const value =
    typeof seconds === 'number' && Number.isFinite(seconds)
      ? Math.floor(seconds)
      : INGEST_BLOCK_MIN_RETRY_SECONDS;
  return Math.min(
    INGEST_BLOCK_MAX_RETRY_SECONDS,
    Math.max(INGEST_BLOCK_MIN_RETRY_SECONDS, value),
  );
}

export function parseIngestBlock(raw: unknown): IngestBlockStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const map = raw as Record<string, unknown>;
  const state = map.state === 'blocked' ? 'blocked' : map.state === 'ok' ? 'ok' : null;
  if (!state) return null;
  const reason = typeof map.reason === 'string' && map.reason.trim() !== '' ? map.reason.trim() : undefined;
  const retry =
    typeof map.retryAfterSeconds === 'number' && Number.isFinite(map.retryAfterSeconds)
      ? Math.floor(map.retryAfterSeconds)
      : undefined;
  return { state, reason, retryAfterSeconds: retry };
}

export function ingestBlockStorageKey(apiKey: string): string {
  return `talaria.ingestBlock.${keyHash(apiKey)}`;
}

export interface IngestBlockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeWarn(message: string): void {
  try {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(message);
    }
  } catch {
    /* a broken console must not reach the host */
  }
}

/**
 * Process (or page) gate for `ingest_blocked`. While paused, ingest sends are
 * skipped. The pause is not persisted across a process restart; the browser
 * keeps it in sessionStorage for the tab session only (IB3).
 */
export class IngestBlockGate {
  private until = 0;
  private reason: string | undefined;
  private warned = false;
  private policyWait: Promise<void> | null = null;
  private resolvePolicy: (() => void) | null = null;

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly warn: (message: string) => void = safeWarn,
  ) {}

  get isBlocked(): boolean {
    return this.clock() < this.until;
  }

  get blockReason(): string | undefined {
    return this.isBlocked ? this.reason : undefined;
  }

  remainingSeconds(): number {
    if (!this.isBlocked) return 0;
    return Math.ceil((this.until - this.clock()) / 1000);
  }

  /** Call when a policy fetch for this page or process starts. */
  beginPolicyCheck(): void {
    if (this.policyWait) return;
    this.policyWait = new Promise((resolve) => {
      this.resolvePolicy = resolve;
    });
  }

  markPolicyChecked(): void {
    this.resolvePolicy?.();
    this.resolvePolicy = null;
    this.policyWait = null;
  }

  /**
   * Browser first-send: wait for the in-flight sdk-config check, up to
   * [timeoutMs], without throwing.
   */
  async waitForPolicy(timeoutMs = 3000): Promise<void> {
    const pending = this.policyWait;
    if (!pending) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pending,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
          timer.unref?.();
        }),
      ]);
    } catch {
      /* a failed check must not break the host */
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  applyFromError(error: IngestError): boolean {
    if (!error.isIngestBlocked) return false;
    this.pause(error.retryAfterSeconds, error.reason);
    return true;
  }

  applyFromDocument(raw: unknown): void {
    const block = parseIngestBlock(raw);
    if (!block) return;
    if (block.state === 'ok') {
      this.clear();
      return;
    }
    this.pause(block.retryAfterSeconds, block.reason);
  }

  pause(seconds: number | null | undefined, reason?: string | null): void {
    const until = this.clock() + clampIngestBlockRetry(seconds) * 1000;
    if (until < this.until) return;
    this.until = until;
    this.reason = reason ?? undefined;
    this.warnOnce();
  }

  clear(): void {
    this.until = 0;
    this.reason = undefined;
  }

  rememberInSession(storage: IngestBlockStorage | null, apiKey: string): void {
    if (!storage || !apiKey) return;
    const key = ingestBlockStorageKey(apiKey);
    try {
      if (!this.isBlocked) {
        storage.removeItem(key);
        return;
      }
      storage.setItem(
        key,
        JSON.stringify({ until: this.until, reason: this.reason ?? null }),
      );
    } catch {
      /* private mode or a full quota must not break the host */
    }
  }

  restoreFromSession(storage: IngestBlockStorage | null, apiKey: string): void {
    if (!storage || !apiKey) return;
    try {
      const raw = storage.getItem(ingestBlockStorageKey(apiKey));
      if (!raw) return;
      const parsed = JSON.parse(raw) as { until?: unknown; reason?: unknown };
      const until = typeof parsed.until === 'number' ? parsed.until : 0;
      if (until <= this.clock()) {
        storage.removeItem(ingestBlockStorageKey(apiKey));
        return;
      }
      this.until = until;
      this.reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;
      this.warnOnce();
    } catch {
      /* ignore a corrupt entry */
    }
  }

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    const reason = this.reason ? ` (${this.reason})` : '';
    this.warn(
      `[Talaria] ingest is stopped${reason}. The SDK will check again in ${this.remainingSeconds()}s and will not send in between. The app keeps running.`,
    );
  }
}

/** True for ingest POST routes; false for `GET /v1/sdk-config`. */
export function isIngestPostPath(path: string, method?: string): boolean {
  if ((method ?? 'POST').toUpperCase() === 'GET') return false;
  return !path.includes('sdk-config');
}
