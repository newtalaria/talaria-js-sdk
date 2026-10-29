/** Which ingest path a permanent error applies to. */
export type IngestSignal = 'events' | 'spans' | 'replay' | 'analytics';

/** Thrown by {@link ServerpodTransport} when an ingest RPC fails. */
export class TransportError extends Error {
  readonly status: number;
  readonly className: string | null;
  readonly code: string | null;
  readonly retry: boolean | null;
  readonly bodyMessage: string | null;

  constructor(
    message: string,
    opts: {
      status: number;
      className?: string | null;
      code?: string | null;
      retry?: boolean | null;
      bodyMessage?: string | null;
    },
  ) {
    super(message);
    this.name = 'TransportError';
    this.status = opts.status;
    this.code = opts.code ?? opts.className ?? null;
    this.className = this.code;
    this.retry = opts.retry ?? null;
    this.bodyMessage = opts.bodyMessage ?? null;
  }
}

/** Classification of a Talaria ingest HTTP error body. */
export class IngestError {
  readonly className: string | null;
  readonly code: string | null;
  readonly message: string | null;
  readonly retry: boolean | null;

  constructor(opts?: {
    className?: string | null;
    code?: string | null;
    message?: string | null;
    retry?: boolean | null;
  }) {
    this.code = opts?.code ?? opts?.className ?? null;
    this.className = this.code;
    this.message = opts?.message ?? null;
    this.retry = opts?.retry ?? null;
  }

  static parse(body: string): IngestError {
    try {
      const decoded = JSON.parse(body) as unknown;
      if (!decoded || typeof decoded !== 'object') {
        return new IngestError();
      }
      const map = decoded as Record<string, unknown>;
      const code = stringOf(map.code);
      if (code || typeof map.type === 'string' || typeof map.detail === 'string') {
        return new IngestError({
          code,
          message: stringOf(map.detail) ?? stringOf(map.title),
          retry: retryForCode(code),
        });
      }
      return new IngestError();
    } catch {
      return new IngestError();
    }
  }

  static fromUnknown(error: unknown): IngestError {
    if (error instanceof TransportError) {
      return new IngestError({
        code: error.code,
        message: error.bodyMessage,
        retry: error.retry,
      });
    }
    return new IngestError();
  }

  /**
   * Permanent failures: dead key, wrong cell, missing scope.
   * Quota, rate limits, and 5xx are never permanent.
   */
  get isPermanent(): boolean {
    if (this.retry === true) return false;
    if (this.code === 'rate_limited' || this.code === 'quota_exceeded') return false;
    if (this.retry === false) return true;
    return (
      this.code === 'invalid_key' ||
      this.code === 'wrong_cell' ||
      this.code === 'insufficient_scope'
    );
  }

  /** A pk key (or a key missing one scope) on a route it cannot call. */
  get isScopeOnly(): boolean {
    return this.code === 'insufficient_scope';
  }

  /** Dead API key. Disable every ingest signal. */
  get isGlobalCredentialFailure(): boolean {
    return this.code === 'invalid_key';
  }
}

function retryForCode(code: string | null): boolean | null {
  if (code === 'rate_limited' || code === 'quota_exceeded') return true;
  if (
    code === 'invalid_key' ||
    code === 'insufficient_scope' ||
    code === 'wrong_cell' ||
    code === 'invalid_body' ||
    code === 'invalid_release'
  ) {
    return false;
  }
  return null;
}

function stringOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
