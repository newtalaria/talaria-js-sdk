import {
  AnalyticsFacade,
  createMemoryStorage,
  IdentityStore,
  ingestEventBatch,
  IngestError,
  isTracingEnabled,
  mergeTags,
  normalizeBreadcrumb,
  normalizeEnvironment,
  normalizeSeverity,
  resolveTracesSampleRate,
  Scope,
  ServerpodTransport,
  severityAtLeast,
  type Breadcrumb,
  type CaptureContext,
  type SeverityLevel,
  type Span,
  type UserContext,
} from '@newtalaria/core';
import { SDK_NAME, SDK_VERSION } from './sdk_meta.js';
import { NodeTracer } from './tracer.js';
import type { TalariaNodeInitOptions } from './types.js';

const PLATFORM = 'node';

export class TalariaNodeClient {
  private options: (TalariaNodeInitOptions & {
    baseUrl: string;
    environment: 'production' | 'staging' | 'development';
    minLevel: SeverityLevel;
    tracingEnabled: boolean;
    tracesSampleRate: number;
    disableDefaultIntegrations: boolean;
  }) | null = null;
  private transport: ServerpodTransport | null = null;
  private tracer: NodeTracer | null = null;
  private readonly scope = new Scope();
  private sessionId: string | null = null;
  private identity: IdentityStore | null = null;
  private analyticsFacade: AnalyticsFacade | null = null;
  private ingestDisabled = false;
  private teardowns: Array<() => void> = [];
  private breadcrumbs: Breadcrumb[] = [];

  init(raw: TalariaNodeInitOptions): void {
    if (this.options) {
      console.warn('@newtalaria/node: already initialized');
      return;
    }
    const baseUrl = (raw.dsn || raw.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) throw new Error('@newtalaria/node: init requires dsn or baseUrl');
    const environment = normalizeEnvironment(String(raw.environment));
    this.options = {
      ...raw,
      baseUrl,
      environment,
      minLevel: raw.minLevel ?? 'debug',
      tracingEnabled: isTracingEnabled(raw),
      tracesSampleRate: resolveTracesSampleRate(raw),
      disableDefaultIntegrations: raw.disableDefaultIntegrations === true,
    };
    this.transport = new ServerpodTransport({
      baseUrl,
      apiKey: raw.apiKey,
    });
    this.identity = new IdentityStore(createMemoryStorage(), {
      initialAnonymousId: raw.anonymousId,
    });
    this.sessionId = this.identity.touchSession();
    this.analyticsFacade = this.createAnalyticsFacade();
    if (raw.enableAnalytics || raw.analyticsEnabled) {
      this.analyticsFacade.optIn();
    }
    if (raw.userId) this.scope.setUser({ id: raw.userId });
    if (raw.tags) this.scope.setTags(raw.tags);

    if (this.options.tracingEnabled) {
      this.tracer = new NodeTracer({
        transport: this.transport,
        sampleRate: this.options.tracesSampleRate,
        resource: {
          'service.name': raw.serviceName || 'node',
          'deployment.environment': environment,
          'telemetry.sdk.name': SDK_NAME,
          'telemetry.sdk.version': SDK_VERSION,
        },
        environment,
        release: raw.release,
        getUserId: () => this.scope.getUserId(),
        getSessionId: () => this.sessionId,
        getAnonymousId: () => this.identity?.getAnonymousId() ?? null,
        onPermanentIngestError: (error) => this.disable(error, 'spans'),
      });
      // Outgoing HTTP patch lives in `index.ts` so `@newtalaria/node/api`
      // stays free of `node:http` for Next.js.
    }

    if (!this.options.disableDefaultIntegrations) {
      this.installProcessHandlers();
    }
  }

  setUser(user: UserContext | null): void {
    this.scope.setUser(user);
  }

  get analytics(): AnalyticsFacade {
    if (!this.analyticsFacade) {
      this.analyticsFacade = this.createAnalyticsFacade();
    }
    return this.analyticsFacade;
  }

  private createAnalyticsFacade(): AnalyticsFacade {
    return new AnalyticsFacade({
      getTransport: () => this.transport,
      getIdentity: () => this.identity,
      getUserId: () => this.scope.getUserId(),
      setUser: (user) => this.setUser(user),
      getReplayId: () => null,
      getTraceId: () => this.getTraceId(),
      getSpanId: () => this.getSpanId(),
      getPlatform: () => PLATFORM,
      getEnvironment: () => this.options?.environment,
      getRelease: () => this.options?.release,
      getPageContext: () => ({}),
      mapScreenToPage: false,
      requireIdentityOnTrack: true,
      logLabel: '@newtalaria/node',
      onPermanentError: (error) => this.disable(error, 'analytics'),
    });
  }

  addBreadcrumb(crumb: Partial<Breadcrumb> & { type?: string; message?: string }): void {
    this.breadcrumbs.push(normalizeBreadcrumb(crumb));
    if (this.breadcrumbs.length > 50) this.breadcrumbs.splice(0, this.breadcrumbs.length - 50);
  }

  startSpan(name: string, opts?: Parameters<NodeTracer['startSpan']>[1]): Span | null {
    return this.tracer?.startSpan(name, opts) ?? null;
  }

  startInactiveSpan(name: string, opts?: Parameters<NodeTracer['startInactiveSpan']>[1]): Span | null {
    return this.tracer?.startInactiveSpan(name, opts) ?? null;
  }

  startTransaction(name: string, opts?: Parameters<NodeTracer['startTransaction']>[1]): Span | null {
    return this.tracer?.startTransaction(name, opts) ?? null;
  }

  resetRequestState(): void {
    this.breadcrumbs = [];
    this.tracer?.resetRequestState();
  }

  getTraceId(): string | null {
    return this.tracer?.getTraceId() ?? null;
  }

  getSpanId(): string | null {
    return this.tracer?.getSpanId() ?? null;
  }

  getTracer(): NodeTracer | null {
    return this.tracer;
  }

  addTeardown(undo: () => void): void {
    this.teardowns.push(undo);
  }

  getHttpInstrumentOptions(): {
    baseUrl: string;
    ignoreUrls?: string[];
  } | null {
    if (!this.options?.tracingEnabled) return null;
    return {
      baseUrl: this.options.baseUrl,
      ignoreUrls: this.options.failedRequestIgnoreUrls,
    };
  }

  async captureException(error: unknown, context?: CaptureContext): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error));
    await this.send({
      message: err.message || String(error),
      level: 'error',
      title: err.name || 'Error',
      stackTrace: err.stack,
      context,
    });
  }

  async captureMessage(
    message: string,
    level: SeverityLevel = 'info',
    context?: CaptureContext,
  ): Promise<void> {
    await this.send({ message, level, context });
  }

  async flush(): Promise<void> {
    await Promise.all([
      this.tracer?.flush() ?? Promise.resolve(),
      this.analyticsFacade?.flush() ?? Promise.resolve(),
    ]);
  }

  async close(): Promise<void> {
    await this.flush();
    for (const undo of this.teardowns) undo();
    this.teardowns = [];
    await this.tracer?.shutdown();
  }

  private installProcessHandlers(): void {
    const onException = (error: unknown) => {
      void this.captureException(error, {
        mechanism: { type: 'uncaughtException', handled: false },
      });
    };
    const onRejection = (reason: unknown) => {
      void this.captureException(reason, {
        mechanism: { type: 'unhandledRejection', handled: false },
      });
    };
    process.on('uncaughtException', onException);
    process.on('unhandledRejection', onRejection);
    this.teardowns.push(() => {
      process.off('uncaughtException', onException);
      process.off('unhandledRejection', onRejection);
    });
  }

  private async send(args: {
    message: string;
    level: SeverityLevel;
    title?: string;
    stackTrace?: string;
    context?: CaptureContext;
  }): Promise<void> {
    if (!this.options || !this.transport || this.ingestDisabled) return;
    const level = normalizeSeverity(args.level) ?? args.level;
    if (!severityAtLeast(level, this.options.minLevel)) return;
    if ((this.options.sampleRate ?? 1) < 1 && Math.random() >= (this.options.sampleRate ?? 1)) {
      return;
    }
    if (level === 'error' || level === 'fatal') this.tracer?.markError();

    this.sessionId = this.identity?.touchSession() ?? this.sessionId;
    const userId = args.context?.userId ?? this.scope.getUserId();
    const tags = mergeTags(this.options.tags, this.scope.getTags(), args.context?.tags);
    const extra = args.context?.extra;
    try {
      await ingestEventBatch(this.transport, [
        {
          message: args.message,
          environment: this.options.environment,
          level,
          eventType:
            level === 'fatal' || level === 'error'
              ? 'error'
              : level === 'warning'
                ? 'warning'
                : level === 'debug'
                  ? 'debug'
                  : 'info',
          title: args.title ?? args.context?.title,
          stackTrace: args.stackTrace,
          exception: args.stackTrace
            ? {
                values: [
                  {
                    type: args.title,
                    value: args.message,
                    mechanism: args.context?.mechanism ?? { type: 'generic', handled: true },
                    stacktrace: undefined,
                  },
                ],
              }
            : undefined,
          platform: PLATFORM,
          release: this.options.release,
          commitSha: this.options.commitSha,
          userId,
          anonymousId: this.identity?.getAnonymousId() ?? undefined,
          sessionId: this.sessionId ?? undefined,
          tags: Object.keys(tags).length ? tags : undefined,
          extraJson: extra ? JSON.stringify(extra) : undefined,
          traceId: this.tracer?.getTraceId() ?? undefined,
          spanId: this.tracer?.getSpanId() ?? undefined,
          breadcrumbs: this.breadcrumbs.length ? this.breadcrumbs : undefined,
        },
      ]);
    } catch (error) {
      console.warn('@newtalaria/node: event ingest failed', error);
      if (IngestError.fromUnknown(error).isPermanent) {
        this.disable(error, 'events');
      }
    }
  }

  private disable(error: unknown, signal: 'events' | 'spans' | 'analytics'): void {
    const parsed = IngestError.fromUnknown(error);
    if (parsed.isScopeOnly) {
      if (signal === 'spans') this.tracer?.disable();
      else if (signal === 'analytics') this.analyticsFacade?.disable();
      else this.ingestDisabled = true;
      return;
    }
    if (signal === 'analytics' && !parsed.isGlobalCredentialFailure) {
      this.analyticsFacade?.disable();
      return;
    }
    this.ingestDisabled = true;
    this.tracer?.disable();
    this.analyticsFacade?.disable();
    console.warn(
      '@newtalaria/node: ingest disabled after permanent client error',
      error,
    );
  }
}
