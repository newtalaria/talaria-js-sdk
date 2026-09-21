import { createId } from './utils/id.js';

export const ANONYMOUS_ID_KEY = 'talaria.anonymousId';
export const SESSION_ID_KEY = 'talaria.sessionId';
export const SESSION_TOUCHED_AT_KEY = 'talaria.sessionTouchedAt';
export const SESSION_UTM_KEY = 'talaria.sessionUtm';

/** Rotate after this much idle time. */
export const SESSION_INACTIVITY_MS = 30 * 60 * 1000;

export interface IdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface FirstTouchAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrer?: string;
}

export interface TouchSessionOptions {
  /** Raw page URL — used to parse first-touch UTM on session start. */
  url?: string;
  /** Raw document.referrer — stored (sanitized) on session start. */
  referrer?: string;
}

export interface IdentityStoreOptions {
  now?: () => Date;
  createId?: () => string;
  /** Used when storage has no anonymous id yet (Node callers). */
  initialAnonymousId?: string;
}

const SENSITIVE_QUERY_KEY =
  /^(?:token|secret|password|auth|api[_-]?key|access[_-]?token|gclid|fbclid|gcl_au|msclkid|_ga(?:_.*)?|cid|sid)$/i;

const UTM_QUERY_TO_FIELD = {
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_term: 'utmTerm',
  utm_content: 'utmContent',
} as const;

type UtmField = (typeof UTM_QUERY_TO_FIELD)[keyof typeof UTM_QUERY_TO_FIELD];

/** In-memory storage (Node, tests, and localStorage fallback). */
export function createMemoryStorage(): IdentityStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/**
 * First-party `localStorage` when available; otherwise memory.
 * Persistence failures (private mode, quota) fall back to memory.
 */
export function createWebStorage(): IdentityStorage {
  const memory = createMemoryStorage();
  try {
    const ls = (globalThis as { localStorage?: IdentityStorage }).localStorage;
    if (!ls) return memory;
    const probe = '__talaria_id_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      getItem: (key) => {
        try {
          return ls.getItem(key);
        } catch {
          return memory.getItem(key);
        }
      },
      setItem: (key, value) => {
        try {
          ls.setItem(key, value);
        } catch {
          memory.setItem(key, value);
        }
      },
      removeItem: (key) => {
        try {
          ls.removeItem(key);
        } catch {
          memory.removeItem(key);
        }
      },
    };
  } catch {
    return memory;
  }
}

function isSensitiveQueryKey(key: string): boolean {
  return SENSITIVE_QUERY_KEY.test(key);
}

/** Redact secret / click-id query keys. Drops the fragment. */
export function sanitizeTelemetryUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    const url = new URL(trimmed);
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) {
        url.searchParams.set(key, '[Filtered]');
      }
    }
    url.hash = '';
    return url.toString();
  } catch {
    return trimmed.split('#')[0] ?? trimmed;
  }
}

/** UTC calendar date `YYYY-MM-DD` for midnight-UTC session rotation. */
export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * First-touch UTM from the landing URL plus a sanitized referrer.
 * Empty fields are omitted.
 */
export function parseFirstTouch(
  url?: string,
  referrer?: string,
): FirstTouchAttribution {
  const out: FirstTouchAttribution = {};
  if (url) {
    try {
      const parsed = new URL(url);
      for (const [query, field] of Object.entries(UTM_QUERY_TO_FIELD) as Array<
        [keyof typeof UTM_QUERY_TO_FIELD, UtmField]
      >) {
        const value = parsed.searchParams.get(query)?.trim();
        if (value) out[field] = value;
      }
    } catch {
      // ignore unparseable URLs
    }
  }
  const cleaned = referrer?.trim() ? sanitizeTelemetryUrl(referrer.trim()) : '';
  if (cleaned) out.referrer = cleaned;
  return out;
}

/**
 * Durable visitor + session identity. Browser persists to `localStorage`;
 * Node uses in-memory storage (per process) unless the caller passes an id.
 */
export class IdentityStore {
  private readonly now: () => Date;
  private readonly makeId: () => string;

  constructor(
    private readonly storage: IdentityStorage,
    options?: IdentityStoreOptions,
  ) {
    this.now = options?.now ?? (() => new Date());
    this.makeId = options?.createId ?? createId;
    this.ensureAnonymousId(options?.initialAnonymousId);
  }

  getAnonymousId(): string {
    return this.ensureAnonymousId();
  }

  getSessionId(): string | null {
    const id = this.storage.getItem(SESSION_ID_KEY)?.trim();
    return id || null;
  }

  getFirstTouch(): FirstTouchAttribution {
    const raw = this.storage.getItem(SESSION_UTM_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return {};
      return sanitizeAttribution(parsed as Record<string, unknown>);
    } catch {
      return {};
    }
  }

  /**
   * Refresh activity. Rotates `sessionId` after 30 minutes idle or when the
   * UTC calendar date changes. Call on init, capture, track, and page.
   */
  touchSession(options?: TouchSessionOptions): string {
    const now = this.now();
    const existing = this.storage.getItem(SESSION_ID_KEY)?.trim();
    const touchedRaw = this.storage.getItem(SESSION_TOUCHED_AT_KEY);
    const touchedAt = touchedRaw ? Date.parse(touchedRaw) : Number.NaN;
    let rotate = !existing || Number.isNaN(touchedAt);
    if (!rotate) {
      if (now.getTime() - touchedAt > SESSION_INACTIVITY_MS) rotate = true;
      else if (utcDateKey(now) !== utcDateKey(new Date(touchedAt))) rotate = true;
    }

    if (rotate) {
      const sessionId = this.makeId();
      this.storage.setItem(SESSION_ID_KEY, sessionId);
      const attribution = parseFirstTouch(options?.url, options?.referrer);
      this.storage.setItem(SESSION_UTM_KEY, JSON.stringify(attribution));
    }

    this.storage.setItem(SESSION_TOUCHED_AT_KEY, now.toISOString());
    return this.storage.getItem(SESSION_ID_KEY)!;
  }

  /** New anonymousId + session; caller clears userId. */
  reset(options?: TouchSessionOptions): { anonymousId: string; sessionId: string } {
    this.storage.setItem(ANONYMOUS_ID_KEY, this.makeId());
    this.storage.removeItem(SESSION_ID_KEY);
    this.storage.removeItem(SESSION_TOUCHED_AT_KEY);
    this.storage.removeItem(SESSION_UTM_KEY);
    const sessionId = this.touchSession(options);
    return { anonymousId: this.getAnonymousId(), sessionId };
  }

  private ensureAnonymousId(initial?: string): string {
    const existing = this.storage.getItem(ANONYMOUS_ID_KEY)?.trim();
    if (existing) return existing;
    const id = initial?.trim() || this.makeId();
    this.storage.setItem(ANONYMOUS_ID_KEY, id);
    return id;
  }
}

function sanitizeAttribution(
  raw: Record<string, unknown>,
): FirstTouchAttribution {
  const out: FirstTouchAttribution = {};
  const assign = (field: UtmField | 'referrer', value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      out[field] = value.trim();
    }
  };
  assign('utmSource', raw.utmSource);
  assign('utmMedium', raw.utmMedium);
  assign('utmCampaign', raw.utmCampaign);
  assign('utmTerm', raw.utmTerm);
  assign('utmContent', raw.utmContent);
  assign('referrer', raw.referrer);
  return out;
}
