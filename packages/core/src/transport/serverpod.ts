import { IngestError, TransportError } from './ingest_error.js';

export interface ServerpodTransportOptions {
  baseUrl: string;
  apiKey: string;
}

/**
 * Wire features the server advertised in `sdk/getConfig`
 * (`capabilities`). Both default to off, so an older server never sees a
 * gzip body or a binary upload.
 */
export interface ServerCapabilities {
  /** RPC bodies may be sent with `Content-Encoding: gzip`. */
  gzipRequests: boolean;
  /**
   * Replay segments and heatmap snapshots may be POSTed as raw gzip to
   * `/ingest/v1/replays/segments` and `/ingest/v1/heatmaps/snapshots`.
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
}

/**
 * Minimal Serverpod RPC client: POST `{baseUrl}/{endpoint}/{method}` with
 * named JSON parameters and API-key auth.
 *
 * Uses global `fetch` (browsers and Node 18+). Never wrap this client with
 * tracing middleware — that would trace Talaria's own transport.
 */
export class ServerpodTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private caps: ServerCapabilities = {
    gzipRequests: false,
    binaryUploads: false,
  };

  constructor(options: ServerpodTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
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
    const url = `${this.baseUrl}/${endpoint}/${method}`;
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
    return this.read(response, `${endpoint}/${method}`);
  }

  /**
   * POST raw bytes to a binary upload route (`path` like
   * `/ingest/v1/replays/segments`) with the small fields as query
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
        'X-API-Key': this.apiKey,
      },
      body: copy,
      credentials: 'omit',
    };
    if (opts?.signal) init.signal = opts.signal;
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
      'X-API-Key': this.apiKey,
    };
    if (gzipped) headers['Content-Encoding'] = 'gzip';
    const init: RequestInit = {
      method: 'POST',
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
      let detail = text.slice(0, 400);
      const className = parsed.className;
      const message = parsed.message;
      if (className || message) {
        detail = [className, message].filter(Boolean).join(': ');
      }
      throw new TransportError(
        `Talaria ${label} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
        {
          status: response.status,
          className: parsed.className,
          retry: parsed.retry,
          bodyMessage: parsed.message,
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
