import {
  AnalyticsFacade,
  createMemoryStorage,
  disabledSignal,
  documentIsFresh,
  EventIngestQueue,
  fetchSdkConfig,
  IdentityStore,
  IngestError,
  mergeTags,
  normalizeBreadcrumb,
  normalizeEnvironment,
  normalizeSeverity,
  readPolicyCache,
  Scope,
  ServerpodTransport,
  severityAtLeast,
  tombstoneFromError,
  tombstoneIsQuiet,
  writePolicyCache,
  type Breadcrumb,
  type CaptureContext,
  type SdkConfigDocument,
  type SdkPolicyStorage,
  type SeverityLevel,
  type Span,
  type UserContext,
} from '@newtalaria/core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
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
    sampleRate: number;
    disableDefaultIntegrations: boolean;
    remoteConfig: boolean;
  }) | null = null;
  private transport: ServerpodTransport | null = null;
  private tracer: NodeTracer | null = null;
  private readonly scope = new Scope();
  private eventQueue: EventIngestQueue | null = null;
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
      tracingEnabled: false,
      tracesSampleRate: 0,
      sampleRate: 1,
      remoteConfig: raw.remoteConfig !== false,
      disableDefaultIntegrations: raw.disableDefaultIntegrations === true,
    };
    this.transport = new ServerpodTransport({
      baseUrl,
      apiKey: raw.apiKey,
    });
    this.eventQueue = EventIngestQueue.forTransport(this.transport, (error) => {
      console.warn('@newtalaria/node: event ingest failed', error);
      if (IngestError.fromUnknown(error).isPermanent) {
        this.disable(error, 'events');
      }
    });
    const flushQueuedEvents = () => {
      void this.eventQueue?.flush();
    };
    process.on('beforeExit', flushQueuedEvents);
    this.teardowns.push(() => process.off('beforeExit', flushQueuedEvents));
    this.identity = new IdentityStore(createMemoryStorage(), {
      initialAnonymousId: raw.anonymousId,
    });
    this.sessionId = this.identity.touchSession();
    this.analyticsFacade = this.createAnalyticsFacade();
    if (raw.userId) this.scope.setUser({ id: raw.userId });
    if (raw.tags) this.scope.setTags(raw.tags);

    if (!this.options.disableDefaultIntegrations) {
      this.installProcessHandlers();
    }
    this.bootstrapPolicy();
  }

  applySdkConfig(document: SdkConfigDocument): void {
    if (!this.options || !this.transport || document.schemaVersion !== 1) return;
    if (document.unchanged) return;
    if (document.active === false) {
      this.ingestDisabled = true;
      this.eventQueue?.disable();
      this.tracer?.disable();
      this.analyticsFacade?.disable();
      return;
    }
    const eventsRate = document.events?.sampleRate;
    this.options.sampleRate =
      eventsRate === null || eventsRate === undefined ? 1 : Math.min(1, Math.max(0, eventsRate));
    const tracingOn = Boolean(document.tracing?.enabled);
    this.options.tracingEnabled = tracingOn;
    this.options.tracesSampleRate = tracingOn
      ? Math.min(1, Math.max(0, document.tracing?.tracesSampleRate ?? 0))
      : 0;
    if (tracingOn && !this.tracer) {
      this.tracer = new NodeTracer({
        transport: this.transport,
        sampleRate: this.options.tracesSampleRate,
        resource: {
          'service.name': this.options.serviceName || 'node',
          'deployment.environment': this.options.environment,
          'telemetry.sdk.name': SDK_NAME,
          'telemetry.sdk.version': SDK_VERSION,
        },
        environment: this.options.environment,
        release: this.options.release,
        getUserId: () => this.scope.getUserId(),
        getSessionId: () => this.sessionId,
        getAnonymousId: () => this.identity?.getAnonymousId() ?? null,
        onPermanentIngestError: (error) => this.disable(error, 'spans'),
      });
    } else if (!tracingOn) {
      this.tracer?.disable();
    }
    if (document.analytics?.enabled) this.analyticsFacade?.optIn();
    else this.analyticsFacade?.disable();
  }

  private bootstrapPolicy(): void {
    if (!this.options || !this.transport || !this.options.remoteConfig) return;
    const storage = nodePolicyStorage();
    const now = Date.now();
    const cached = readPolicyCache(storage, this.options.apiKey);
    if (cached && tombstoneIsQuiet(cached, now)) {
      this.ingestDisabled = true;
      this.eventQueue?.disable();
      return;
    }
    if (cached?.kind === 'document' && cached.document) {
      this.applySdkConfig(cached.document);
      if (documentIsFresh(cached, now)) return;
    }
    void fetchSdkConfig(this.transport, {
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
      platform: 'node',
      revision: cached?.document?.revision,
    })
      .then((document) => {
        if (!this.options) return;
        if (!document.unchanged) this.applySdkConfig(document);
        const stored = document.unchanged && cached?.document ? cached.document : document;
        writePolicyCache(storage, this.options.apiKey, {
          kind: 'document',
          fetchedAt: Date.now(),
          document: stored,
        });
      })
      .catch((error: unknown) => {
        const tombstone = tombstoneFromError(error, Date.now());
        if (!tombstone || !this.options) return;
        writePolicyCache(storage, this.options.apiKey, tombstone);
        this.ingestDisabled = true;
        this.eventQueue?.disable();
      });
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
      this.eventQueue?.flush() ?? Promise.resolve(),
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
      await this.eventQueue?.enqueue({
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
        });
    } catch (error) {
      console.warn('@newtalaria/node: event ingest failed', error);
      if (IngestError.fromUnknown(error).isPermanent) {
        this.disable(error, 'events');
      }
    }
  }

  private disable(error: unknown, signal: 'events' | 'spans' | 'analytics'): void {
    const parsed = IngestError.fromUnknown(error);
    const signalOff = disabledSignal(error);
    if (signalOff === 'spans') {
      this.tracer?.disable();
      return;
    }
    if (signalOff === 'analytics') {
      this.analyticsFacade?.disable();
      return;
    }
    if (signalOff === 'events') {
      this.ingestDisabled = true;
      this.eventQueue?.disable();
      return;
    }
    if (parsed.isScopeOnly) {
      if (signal === 'spans') this.tracer?.disable();
      else if (signal === 'analytics') this.analyticsFacade?.disable();
      else {
        this.ingestDisabled = true;
        this.eventQueue?.disable();
      }
      return;
    }
    if (signal === 'analytics' && !parsed.isGlobalCredentialFailure) {
      this.analyticsFacade?.disable();
      return;
    }
    this.ingestDisabled = true;
    this.eventQueue?.disable();
    this.tracer?.disable();
    this.analyticsFacade?.disable();
    console.warn(
      '@newtalaria/node: ingest disabled after permanent client error',
      error,
    );
  }
}

function nodePolicyStorage(): SdkPolicyStorage {
  return {
    get: (key) => {
      try {
        return readFileSync(nodePolicyPath(key), 'utf8');
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        const path = nodePolicyPath(key);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, value);
      } catch {
        /* read-only filesystem */
      }
    },
    remove: () => {},
  };
}

function nodePolicyPath(key: string): string {
  return `${tmpdir()}/talaria/${key.replace(/[^\w.-]/g, '_')}.json`;
}
