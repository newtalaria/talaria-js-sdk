import { IngestError, TransportError } from './ingest_error.js';

export interface ServerpodTransportOptions {
  baseUrl: string;
  apiKey: string;
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

  constructor(options: ServerpodTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async call(
    endpoint: string,
    method: string,
    body: Record<string, unknown>,
    opts?: { keepalive?: boolean },
  ): Promise<unknown> {
    const url = `${this.baseUrl}/${endpoint}/${method}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'X-API-Key': this.apiKey,
    };

    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'omit',
    };
    if (opts?.keepalive) {
      init.keepalive = true;
    }

    const response = await fetch(url, init);

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
        `Talaria ${endpoint}/${method} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
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
