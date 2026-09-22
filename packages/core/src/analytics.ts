import { createId } from './utils/id.js';
import {
  IdentityStore,
  sanitizeTelemetryUrl,
  type FirstTouchAttribution,
} from './identity.js';
import { IngestError } from './transport/ingest_error.js';
import type { ServerpodTransport } from './transport/serverpod.js';
import {
  ANALYTICS_DEFAULT_NAMES,
  MAX_ANALYTICS_BATCH,
  ingestAnalyticsEventBatch,
  type AnalyticsEventKind,
  type IngestAnalyticsEventParams,
} from './transport/analytics.js';
import type { UserContext } from './types.js';

export interface AnalyticsCallOptions {
  userId?: string;
  anonymousId?: string;
}

export interface AnalyticsPageContext {
  url?: string;
  path?: string;
  title?: string;
  referrer?: string;
}

export interface AnalyticsRuntimeContext {
  browserName?: string;
  browserVersion?: string;
  browserEngine?: string;
  osName?: string;
  osVersion?: string;
  device?: string;
  locale?: string;
  timezone?: string;
  webview?: boolean;
  webviewHost?: string;
  bot?: boolean;
  botName?: string;
  botKind?: string;
  webdriver?: boolean;
}

export interface AnalyticsBindings {
  getTransport: () => ServerpodTransport | null;
  getIdentity: () => IdentityStore | null;
  getUserId: () => string | undefined;
  setUser: (user: UserContext | null) => void;
  getReplayId: () => string | null;
  getTraceId: () => string | null;
  getSpanId: () => string | null;
  getPlatform: () => string;
  getEnvironment: () => string | undefined;
  getRelease: () => string | undefined;
  /** Raw page URL / referrer (UTM parsed before sanitizing the wire fields). */
  getPageContext: () => AnalyticsPageContext;
  /** Parsed browser / device / traffic class. Never include raw UA here. */
  getRuntimeContext?: () => AnalyticsRuntimeContext | undefined;
  /** Web maps `screen()` to a page event. */
  mapScreenToPage: boolean;
  /** Node: skip track/identify when neither userId nor anonymousId is present. */
  requireIdentityOnTrack?: boolean;
  logLabel: string;
  onPermanentError: (error: unknown) => void;
  /** Fired the first time consent is granted (auto `$pageview` on web). */
  onOptIn?: () => void;
  now?: () => Date;
  createId?: () => string;
}

function stringifyProperties(
  properties?: Record<string, unknown>,
): string | undefined {
  if (!properties || Object.keys(properties).length === 0) return undefined;
  try {
    return JSON.stringify(properties);
  } catch {
    return undefined;
  }
}

function resolveName(
  kind: AnalyticsEventKind,
  name?: string,
): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return ANALYTICS_DEFAULT_NAMES[kind];
}

/**
 * Product-analytics API (`Talaria.analytics.*`). Consent defaults off.
 * Identity (anonymousId / sessionId) still lives on the host IdentityStore.
 */
export class AnalyticsFacade {
  private consent = false;
  private killed = false;
  private queue: IngestAnalyticsEventParams[] = [];
  private flushChain: Promise<void> = Promise.resolve();
  private readonly now: () => Date;
  private readonly makeId: () => string;

  constructor(private readonly bindings: AnalyticsBindings) {
    this.now = bindings.now ?? (() => new Date());
    this.makeId = bindings.createId ?? createId;
  }

  isEnabled(): boolean {
    return this.consent && !this.killed;
  }

  optIn(): void {
    if (this.consent) return;
    this.consent = true;
    if (!this.killed) this.bindings.onOptIn?.();
  }

  optOut(): void {
    this.consent = false;
    this.queue.length = 0;
  }

  /** Kill switch — does not persist across reload. */
  disable(): void {
    this.killed = true;
    this.queue.length = 0;
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    const id = userId?.trim();
    if (id) this.bindings.setUser({ id });
    else this.bindings.setUser(null);
    if (!id) return;
    this.enqueue('identify', resolveName('identify'), traits);
  }

  track(
    name: string,
    properties?: Record<string, unknown>,
    options?: AnalyticsCallOptions,
  ): void {
    const resolved = name?.trim();
    if (!resolved) {
      console.warn(`${this.bindings.logLabel}: analytics.track requires a name`);
      return;
    }
    this.enqueue('track', resolved, properties, options);
  }

  page(
    nameOrProps?: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    const { name, props } = splitNameAndProps(
      nameOrProps,
      properties,
      ANALYTICS_DEFAULT_NAMES.page,
    );
    this.enqueue('page', name, props);
  }

  screen(
    nameOrProps?: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    if (this.bindings.mapScreenToPage) {
      this.page(nameOrProps, properties);
      return;
    }
    const { name, props } = splitNameAndProps(
      nameOrProps,
      properties,
      ANALYTICS_DEFAULT_NAMES.screen,
    );
    this.enqueue('screen', name, props);
  }

  reset(): void {
    const ctx = this.bindings.getPageContext();
    this.bindings.getIdentity()?.reset({
      url: ctx.url,
      referrer: ctx.referrer,
    });
    this.bindings.setUser(null);
  }

  async flush(opts?: { keepalive?: boolean }): Promise<void> {
    this.flushChain = this.flushChain.then(
      () => this.flushOnce(opts),
      () => this.flushOnce(opts),
    );
    return this.flushChain;
  }

  private enqueue(
    kind: AnalyticsEventKind,
    name: string,
    properties?: Record<string, unknown>,
    options?: AnalyticsCallOptions,
  ): void {
    if (!this.isEnabled()) return;
    const identity = this.bindings.getIdentity();
    if (!identity) return;

    const ctx = this.bindings.getPageContext();
    const sessionId = identity.touchSession({
      url: ctx.url,
      referrer: ctx.referrer,
    });
    const anonymousId =
      options?.anonymousId?.trim() || identity.getAnonymousId();
    const userId = options?.userId?.trim() || this.bindings.getUserId();

    if (
      this.bindings.requireIdentityOnTrack &&
      kind !== 'identify' &&
      !anonymousId &&
      !userId
    ) {
      console.warn(
        `${this.bindings.logLabel}: analytics.${kind} requires userId and/or anonymousId`,
      );
      return;
    }
    if (!anonymousId || !sessionId) return;

    const firstTouch = identity.getFirstTouch();
    const runtime = this.bindings.getRuntimeContext?.();
    const event: IngestAnalyticsEventParams = {
      eventId: this.makeId(),
      name,
      kind,
      anonymousId,
      sessionId,
      timestamp: this.now().toISOString(),
      userId: userId || undefined,
      replayId: this.bindings.getReplayId() ?? undefined,
      traceId: this.bindings.getTraceId() ?? undefined,
      spanId: this.bindings.getSpanId() ?? undefined,
      platform: this.bindings.getPlatform(),
      environment: this.bindings.getEnvironment(),
      release: this.bindings.getRelease(),
      url: ctx.url ? sanitizeTelemetryUrl(ctx.url) : undefined,
      path: ctx.path,
      title: ctx.title,
      referrer: wireReferrer(ctx.referrer, firstTouch),
      utmSource: firstTouch.utmSource,
      utmMedium: firstTouch.utmMedium,
      utmCampaign: firstTouch.utmCampaign,
      utmTerm: firstTouch.utmTerm,
      utmContent: firstTouch.utmContent,
      propertiesJson: stringifyProperties(properties),
      browserName: runtime?.browserName,
      browserVersion: runtime?.browserVersion,
      browserEngine: runtime?.browserEngine,
      osName: runtime?.osName,
      osVersion: runtime?.osVersion,
      device: runtime?.device,
      locale: runtime?.locale,
      timezone: runtime?.timezone,
      webview: runtime?.webview,
      webviewHost: runtime?.webviewHost,
      bot: runtime?.bot,
      botName: runtime?.botName,
      botKind: runtime?.botKind,
      webdriver: runtime?.webdriver,
    };
    this.queue.push(event);
    void this.flush();
  }

  private async flushOnce(opts?: { keepalive?: boolean }): Promise<void> {
    if (!this.isEnabled()) {
      this.queue.length = 0;
      return;
    }
    const transport = this.bindings.getTransport();
    if (!transport || this.queue.length === 0) return;

    while (this.queue.length > 0 && this.isEnabled()) {
      const batch = this.queue.splice(0, MAX_ANALYTICS_BATCH);
      try {
        await ingestAnalyticsEventBatch(transport, batch, opts);
      } catch (error) {
        console.warn(`${this.bindings.logLabel}: analytics ingest failed`, error);
        const parsed = IngestError.fromUnknown(error);
        if (parsed.isScopeOnly || parsed.isPermanent) {
          this.killed = true;
          this.queue.length = 0;
          this.bindings.onPermanentError(error);
        }
        return;
      }
    }
  }
}

function splitNameAndProps(
  nameOrProps: string | Record<string, unknown> | undefined,
  properties: Record<string, unknown> | undefined,
  fallbackName: string,
): { name: string; props?: Record<string, unknown> } {
  if (typeof nameOrProps === 'string') {
    return { name: nameOrProps.trim() || fallbackName, props: properties };
  }
  if (nameOrProps && typeof nameOrProps === 'object') {
    return { name: fallbackName, props: nameOrProps };
  }
  return { name: fallbackName, props: properties };
}

function wireReferrer(
  current?: string,
  firstTouch?: FirstTouchAttribution,
): string | undefined {
  if (firstTouch?.referrer) return firstTouch.referrer;
  const trimmed = current?.trim();
  return trimmed ? sanitizeTelemetryUrl(trimmed) : undefined;
}
