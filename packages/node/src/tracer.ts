import {
  createSpanId,
  createTraceId,
  getCurrentSpanContext,
  headSample,
  ingestSpanBatch,
  IngestError,
  NoopSpan,
  RecordingSpan,
  setCurrentSpanContext,
  shouldKeepTransaction,
  stringifyAttrMap,
  toIngestSpan,
  type ServerpodTransport,
  type Span,
  type SpanContext,
  type SpanKind,
  type SpanStatus,
} from '@newtalaria/core';

export interface NodeTracerOptions {
  transport: ServerpodTransport;
  sampleRate: number;
  resource: Record<string, string>;
  environment: string;
  release?: string;
  getUserId: () => string | undefined;
  getSessionId: () => string | null;
  getAnonymousId: () => string | null;
  onPermanentIngestError?: (error: unknown) => void;
}

export interface StartSpanOptions {
  kind?: SpanKind;
  parent?: SpanContext | null;
  attributes?: Record<string, string | number | boolean>;
  startTime?: Date;
}

const MAX_SPANS = 200;

export class NodeTracer {
  private readonly options: NodeTracerOptions;
  private sampled = false;
  private hasError = false;
  private spanCount = 0;
  private root: RecordingSpan | null = null;
  private readonly ended: RecordingSpan[] = [];
  private flushChain: Promise<void> = Promise.resolve();
  private disabled = false;

  constructor(options: NodeTracerOptions) {
    this.options = options;
  }

  disable(): void {
    this.disabled = true;
    this.ended.length = 0;
  }

  isSampled(): boolean {
    return shouldKeepTransaction(this.sampled, this.hasError);
  }

  getTraceId(): string | null {
    return getCurrentSpanContext()?.traceId ?? this.root?.context.traceId ?? null;
  }

  getSpanId(): string | null {
    return getCurrentSpanContext()?.spanId ?? this.root?.context.spanId ?? null;
  }

  markError(): void {
    this.hasError = true;
    this.sampled = true;
    const ctx = getCurrentSpanContext();
    if (ctx && !ctx.sampled) setCurrentSpanContext({ ...ctx, sampled: true });
  }

  startTransaction(
    name: string,
    opts?: StartSpanOptions & { parent?: SpanContext | null },
  ): Span {
    this.endRoot();
    const parent = opts?.parent ?? null;
    const traceId = parent?.traceId ?? createTraceId();
    const spanId = createSpanId();
    this.sampled = parent?.sampled ?? headSample(this.options.sampleRate);
    this.hasError = false;
    this.spanCount = 0;
    this.ended.length = 0;
    const ctx: SpanContext = { traceId, spanId, sampled: this.sampled };
    setCurrentSpanContext(ctx);
    const span = this.createSpan(name, { ...opts, parent, context: ctx });
    this.root = span instanceof RecordingSpan ? span : null;
    return span;
  }

  startSpan(name: string, opts?: StartSpanOptions): Span | null {
    const parent = opts?.parent === undefined ? getCurrentSpanContext() : opts.parent;
    if (!parent) return null;
    return this.createSpan(name, { ...opts, parent });
  }

  startInactiveSpan(name: string, opts?: StartSpanOptions): Span | null {
    return this.startSpan(name, opts);
  }

  endRoot(): void {
    if (!this.root || this.root.isEnded()) return;
    if (this.root.data.status === 'unset' && this.isSampled() && !this.hasError) {
      this.root.setStatus('ok');
    }
    this.root.end();
  }

  resetRequestState(): void {
    this.endRoot();
    void this.flush();
    setCurrentSpanContext(null);
    this.root = null;
    this.ended.length = 0;
    this.spanCount = 0;
  }

  flush(opts?: { keepalive?: boolean }): Promise<void> {
    this.flushChain = this.flushChain.then(
      () => this.flushOnce(opts),
      () => this.flushOnce(opts),
    );
    return this.flushChain;
  }

  async shutdown(): Promise<void> {
    this.endRoot();
    await this.flush();
    setCurrentSpanContext(null);
  }

  private createSpan(
    name: string,
    opts: StartSpanOptions & { parent?: SpanContext | null; context?: SpanContext },
  ): Span {
    if (this.disabled || this.spanCount >= MAX_SPANS) {
      return new NoopSpan(
        opts.context ?? {
          traceId: opts.parent?.traceId ?? createTraceId(),
          spanId: createSpanId(),
          sampled: false,
        },
      );
    }
    const parent = opts.parent;
    const ctx =
      opts.context ??
      ({
        traceId: parent?.traceId ?? createTraceId(),
        spanId: createSpanId(),
        sampled: this.isSampled(),
      } satisfies SpanContext);
    this.spanCount += 1;
    return new RecordingSpan(
      {
        context: ctx,
        parentSpanId: parent && parent.spanId !== ctx.spanId ? parent.spanId : undefined,
        name,
        kind: opts.kind ?? 'internal',
        startTime: opts.startTime ?? new Date(),
        status: 'unset' as SpanStatus,
        attributes: opts.attributes ? stringifyAttrMap(opts.attributes) : {},
        events: [],
        links: [],
        ended: false,
        flushed: false,
      },
      (span) => {
        this.ended.push(span);
      },
    );
  }

  private async flushOnce(opts?: { keepalive?: boolean }): Promise<void> {
    if (this.disabled || !shouldKeepTransaction(this.sampled, this.hasError)) {
      return;
    }
    const ready = this.ended.filter((span) => span.isEnded() && !span.data.flushed);
    if (ready.length === 0) return;
    const extras = {
      resource: this.options.resource,
      environment: this.options.environment,
      release: this.options.release,
      userId: this.options.getUserId(),
      anonymousId: this.options.getAnonymousId() ?? undefined,
      sessionId: this.options.getSessionId() ?? undefined,
    };
    const payload = ready.map((span) => {
      span.data.flushed = true;
      return toIngestSpan(span.data, extras);
    });
    try {
      await ingestSpanBatch(this.options.transport, payload, opts);
    } catch (error) {
      for (const span of ready) span.data.flushed = false;
      console.warn('@newtalaria/node: spans/ingestBatch failed', error);
      if (IngestError.fromUnknown(error).isPermanent) {
        this.disabled = true;
        this.options.onPermanentIngestError?.(error);
      }
    }
  }
}
