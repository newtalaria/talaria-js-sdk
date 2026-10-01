import type { ClassifiedClick } from './click_classifier.js';
import { ScrollTracker, type ScrollSample } from './scroll_tracker.js';
import type {
  HeatmapClickParams,
  HeatmapPageViewParams,
} from '../transport/heatmaps.js';

/** Clicks kept per pageview; the rest are dropped client-side. */
export const MAX_CLICKS_PER_PAGEVIEW = 500;

export interface HeatmapPageViewContext {
  pageViewId: string;
  anonymousId: string;
  sessionId: string;
  userId?: string;
  url: string;
  path?: string;
  startedAt: Date;
  release?: string;
  browserName?: string;
  browserVersion?: string;
  osName?: string;
  device?: string;
  bot?: boolean;
  botKind?: string;
  webdriver?: boolean;
}

interface OpenPageView {
  ctx: HeatmapPageViewContext;
  scroll: ScrollTracker;
  pendingClicks: HeatmapClickParams[];
  clickCount: number;
  sentOnce: boolean;
  replayId?: string;
}

/**
 * Holds the open pageview (plus any closed-but-unsent ones) and produces
 * wire payloads. A pageview is resent whenever its scroll reach grows; its
 * clicks are sent once each.
 */
export class HeatmapBuffer {
  private current: OpenPageView | null = null;
  private closed: OpenPageView[] = [];

  get currentPageViewId(): string | null {
    return this.current?.ctx.pageViewId ?? null;
  }

  start(ctx: HeatmapPageViewContext, sample?: ScrollSample): void {
    this.close();
    const scroll = new ScrollTracker();
    if (sample) scroll.update(sample);
    this.current = {
      ctx,
      scroll,
      pendingClicks: [],
      clickCount: 0,
      sentOnce: false,
    };
  }

  close(): void {
    if (this.current) this.closed.push(this.current);
    this.current = null;
  }

  updateScroll(sample: ScrollSample): void {
    this.current?.scroll.update(sample);
  }

  setReplayId(replayId: string | null | undefined): void {
    if (this.current && replayId) this.current.replayId = replayId;
  }

  /** Returns false with no open pageview or at the click cap. */
  addClick(click: ClassifiedClick): boolean {
    const pv = this.current;
    if (!pv || pv.clickCount >= MAX_CLICKS_PER_PAGEVIEW) return false;
    pv.pendingClicks.push({
      clickIndex: pv.clickCount,
      occurredAt: new Date(click.occurredAt).toISOString(),
      selector: click.selector,
      tag: click.tag,
      relX: click.relX,
      relY: click.relY,
      pageX: click.pageX,
      pageY: click.pageY,
      rage: click.rage,
      dead: click.dead,
      error: click.error,
    });
    pv.clickCount += 1;
    return true;
  }

  hasPending(): boolean {
    const all = this.current ? [...this.closed, this.current] : this.closed;
    return all.some((pv) => isSendable(pv));
  }

  /** Payloads for everything that changed; marks them sent. */
  drain(now: Date): HeatmapPageViewParams[] {
    const out: HeatmapPageViewParams[] = [];
    const all = this.current ? [...this.closed, this.current] : [...this.closed];
    for (const pv of all) {
      if (!isSendable(pv)) continue;
      const params = toParams(pv, now);
      if (!params) continue;
      out.push(params);
      pv.pendingClicks = [];
      pv.sentOnce = true;
      pv.scroll.markSent();
    }
    this.closed = [];
    return out;
  }

  clear(): void {
    this.current = null;
    this.closed = [];
  }
}

function isSendable(pv: OpenPageView): boolean {
  if (!pv.scroll.snapshot()) return false;
  return !pv.sentOnce || pv.scroll.isDirty() || pv.pendingClicks.length > 0;
}

function toParams(pv: OpenPageView, now: Date): HeatmapPageViewParams | null {
  const scroll = pv.scroll.snapshot();
  if (!scroll) return null;
  const c = pv.ctx;
  return {
    pageViewId: c.pageViewId,
    anonymousId: c.anonymousId,
    sessionId: c.sessionId,
    userId: c.userId,
    replayId: pv.replayId,
    url: c.url,
    path: c.path,
    startedAt: c.startedAt.toISOString(),
    updatedAt: now.toISOString(),
    viewportWidth: scroll.viewportWidth,
    viewportHeight: scroll.viewportHeight,
    documentWidth: scroll.documentWidth,
    documentHeight: scroll.documentHeight,
    maxScrollDepthPx: scroll.maxScrollDepthPx,
    initialFoldPx: scroll.initialFoldPx,
    release: c.release,
    browserName: c.browserName,
    browserVersion: c.browserVersion,
    osName: c.osName,
    device: c.device,
    bot: c.bot,
    botKind: c.botKind,
    webdriver: c.webdriver,
    clicks: pv.pendingClicks,
  };
}
