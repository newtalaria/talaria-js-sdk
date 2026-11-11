import { IngestError, TransportError } from './ingest_error.js';
import {
  IngestBlockGate,
  isIngestPostPath,
} from './ingest_block.js';

export interface ServerpodTransportOptions {
  baseUrl: string;
  apiKey: string;
  /** Shared gate for `ingest_blocked`. Created if omitted. */
  blockGate?: IngestBlockGate;
}

/**
 * Wire features the server advertised on `GET /v1/sdk-config`
 * (`capabilities`). Both default to off, so an older server never sees a
 * gzip body or a binary upload.
 */
export interface ServerCapabilities {
  /** RPC bodies may be sent with `Content-Encoding: gzip`. */
  gzipRequests: boolean;
  /**
   * Replay segments and heatmap snapshots may be POSTed as raw gzip to
   * `/v1/replays/segments` and `/v1/heatmaps/snapshots`.
   */
  binaryUploads: boolean;
}

/** Smallest JSON body worth gzipping; below this the header costs more. */
export const GZIP_MIN_BYTES = 1024;

export interface CallOptions {
  /**
   * Page-close / unload send. Never gzipped (CompressionStream is async and
   * may not finish before the page goes) and never a binary upload.
   */
  keepalive?: boolean;
  signal?: AbortSignal;
  /** HTTP method override (default: POST) */
  method?: 'GET' | 'POST' | 'PUT';
}

/**
 * JSON client: `{baseUrl}/{endpoint}/{method}` with `Authorization: Bearer`.
 * Bodies are plain JSON. Batch routes use `{"<plural>":[…]}`.
 *
 * Uses global `fetch` (browsers and Node 18+). Never wrap this client with
 * tracing middleware — that would trace Talaria's own transport.
 */
export class ServerpodTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  readonly blockGate: IngestBlockGate;
  private caps: ServerCapabilities = {
    gzipRequests: false,
    binaryUploads: false,
  };

  constructor(options: ServerpodTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.blockGate = options.blockGate ?? new IngestBlockGate();
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** What the server advertised (both off until getConfig says otherwise). */
  get capabilities(): Readonly<ServerCapabilities> {
    return this.caps;
  }

  /**
   * Applies `capabilities` from a getConfig response (full or `unchanged`).
   * A missing object means an older server: everything off.
   */
  setCapabilities(raw: unknown): void {
    const map =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    this.caps = {
      gzipRequests: map.gzipRequests === true,
      binaryUploads: map.binaryUploads === true,
    };
  }

  /** The binary routes answered 404/405/415: use base64 RPC from now on. */
  disableBinaryUploads(): void {
    this.caps = { ...this.caps, binaryUploads: false };
  }

  async call(
    endpoint: string,
    method: string,
    body: Record<string, unknown>,
    opts?: CallOptions,
  ): Promise<unknown> {
    const path = [endpoint, method].filter((part) => part.length > 0).join('/');
    let url = `${this.baseUrl}/${path}`;
    const label = path;
    await this.blockGate.waitForPolicy();
    if (this.blockGate.isBlocked && isIngestPostPath(path, opts?.method)) {
      return undefined;
    }

    if (opts?.method === 'GET') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) params.set(key, value.join(','));
        else if (typeof value === 'object') params.set(key, JSON.stringify(value));
        else params.set(key, String(value));
      }
      const query = params.toString();
      if (query) url += `?${query}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        credentials: 'omit',
        signal: opts.signal,
      });
      return this.read(response, label);
    }

    const json = JSON.stringify(body);
    let gzipped = false;
    let payload: string | Uint8Array = json;
    if (this.caps.gzipRequests && !opts?.keepalive) {
      const compressed = await gzipJson(json);
      if (compressed) {
        payload = compressed;
        gzipped = true;
      }
    }

    let response = await fetch(url, this.init(payload, gzipped, opts));
    if (gzipped && response.status === 415) {
      // The server stopped accepting gzip (rollback): resend plain, and
      // stop compressing until getConfig advertises it again.
      this.caps = { ...this.caps, gzipRequests: false };
      response = await fetch(url, this.init(json, false, opts));
    }
    return this.read(response, label);
  }

  /**
   * POST raw bytes to a binary upload route (`path` like
   * `/v1/replays/segments`) with the small fields as query
   * parameters. Callers check `capabilities.binaryUploads` first.
   */
  async callBinary(
    path: string,
    query: Record<string, string | number>,
    bytes: Uint8Array,
    opts?: { signal?: AbortSignal },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      params.set(key, String(value));
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: copy,
      credentials: 'omit',
    };
    if (opts?.signal) init.signal = opts.signal;
    await this.blockGate.waitForPolicy();
    if (this.blockGate.isBlocked) {
      return undefined;
    }
    const response = await fetch(`${this.baseUrl}${path}?${params}`, init);
    return this.read(response, path.replace(/^\//, ''));
  }

  private init(
    body: string | Uint8Array,
    gzipped: boolean,
    opts?: CallOptions,
  ): RequestInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (gzipped) headers['Content-Encoding'] = 'gzip';
    const init: RequestInit = {
      method: opts?.method || 'POST',
      headers,
      body,
      credentials: 'omit',
    };
    if (opts?.keepalive) {
      init.keepalive = true;
    }
    if (opts?.signal) {
      init.signal = opts.signal;
    }
    return init;
  }

  private async read(response: Response, label: string): Promise<unknown> {
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const parsed = IngestError.parse(text);
      const retryAfter =
        parsed.retryAfterSeconds ?? parseRetryAfter(response.headers.get('retry-after'));
      const error = new IngestError({
        code: parsed.code,
        message: parsed.message,
        retry: parsed.retry,
        reason: parsed.reason,
        retryAfterSeconds: retryAfter,
      });
      this.blockGate.applyFromError(error);
      let detail = text.slice(0, 400);
      const code = error.code ?? error.className;
      const message = error.message;
      if (code || message) {
        detail = [code, message].filter(Boolean).join(': ');
      }
      throw new TransportError(
        `Talaria ${label} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
        {
          status: response.status,
          className: error.className,
          code: error.code,
          retry: error.retry,
          bodyMessage: error.message,
          reason: error.reason,
          retryAfterSeconds: error.retryAfterSeconds,
        },
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return undefined;
  }
}

/**
 * Gzips a JSON body with CompressionStream (browsers, Node 18+). `null`
 * when it is small, the API is missing, or compression didn't help.
 */
export async function gzipJson(json: string): Promise<Uint8Array | null> {
  const bytes = new TextEncoder().encode(json);
  if (bytes.length < GZIP_MIN_BYTES) return null;
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    return out.length < bytes.length ? out : null;
  } catch {
    return null;
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) ? Math.floor(seconds) : null;
}

