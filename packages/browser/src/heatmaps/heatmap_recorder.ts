import { IngestError, sanitizeTelemetryUrl } from '@newtalaria/core';
import type { ServerpodTransport } from '../transport/serverpod.js';
import {
  MAX_KEEPALIVE_BODY_BYTES,
  chunkHeatmapPageViews,
  ingestHeatmapBatch,
  uploadHeatmapSnapshot,
} from '../transport/heatmaps.js';
import { defaultBlockSelector } from '../replay/privacy.js';
import { buildSelector, type SelectorElement } from './selector.js';
import { ClickClassifier, type ClickInput } from './click_classifier.js';
import { HeatmapBuffer, type HeatmapPageViewContext } from './heatmap_buffer.js';
import type { ScrollSample } from './scroll_tracker.js';
import { captureHeatmapSnapshot, type CapturedHeatmapSnapshot } from './snapshot.js';

/** First send soon after a pageview starts so a snapshot request comes back early. */
export const HEATMAP_FIRST_FLUSH_MS = 3_000;
export const HEATMAP_FLUSH_MS = 5_000;
const TICK_MS = 500;
/** Wait after `load` before snapshotting so late layout settles. */
const SNAPSHOT_SETTLE_MS = 2_000;

/** Clicks on (or inside) these count toward the control, not the inner icon/span. */
const INTERACTIVE_SELECTOR =
  'a,button,[role="button"],[role="link"],[role="tab"],[role="menuitem"],summary,label,select,input,textarea';
const FORM_LIKE_SELECTOR = 'input,select,textarea,label,option,[contenteditable=""],[contenteditable="true"]';

export type HeatmapPageViewBase = Omit<HeatmapPageViewContext, 'pageViewId' | 'startedAt'>;

export interface HeatmapRecorderOptions {
  getTransport: () => ServerpodTransport | null;
  /** Analytics consent + `heatmaps` option. Checked before every capture and send. */
  isEnabled: () => boolean;
  getPageViewBase: () => HeatmapPageViewBase | null;
  getReplayId: () => string | null;
  maskAllInputs: boolean;
  blockSelector?: string;
  /** Global credential failure (dead key / origin / project). */
  onGlobalFailure: (error: unknown) => void;
  now?: () => number;
  captureSnapshot?: typeof captureHeatmapSnapshot;
  /** Skip DOM listeners and timers (tests drive the recorder directly). */
  headless?: boolean;
}

/**
 * Heatmap capture for the current page: element-based clicks with
 * rage / dead / error flags, scroll reach, and on-request DOM snapshots.
 */
export class HeatmapRecorder {
  private readonly buffer = new HeatmapBuffer();
  private readonly classifier: ClickClassifier;
  private readonly now: () => number;
  private readonly blockSelector: string;
  private killed = false;
  private teardowns: Array<() => void> = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private nextFlushAt = Number.POSITIVE_INFINITY;
  private flushChain: Promise<void> = Promise.resolve();
  private observer: MutationObserver | null = null;
  private snapshotInFlight: string | null = null;
  private scrollFrame = 0;

  constructor(private readonly options: HeatmapRecorderOptions) {
    this.now = options.now ?? (() => Date.now());
    this.blockSelector = defaultBlockSelector(options.blockSelector);
    this.classifier = new ClickClassifier((click) => {
      this.buffer.addClick(click);
    });
    if (!options.headless) this.install();
  }

  get currentPageViewId(): string | null {
    return this.buffer.currentPageViewId;
  }

  private active(): boolean {
    return !this.killed && this.options.isEnabled();
  }

  /** Close the previous pageview and open a new one (auto `$pageview`). */
  startPageView(pageViewId: string, sample?: ScrollSample): void {
    if (!this.active()) return;
    const base = this.options.getPageViewBase();
    if (!base) return;
    const now = this.now();
    this.classifier.flushAll(now);
    this.buffer.close();
    if (this.buffer.hasPending()) void this.flush();
    this.buffer.start(
      { ...base, url: sanitizeTelemetryUrl(base.url), pageViewId, startedAt: new Date(now) },
      sample ?? readScrollSample(),
    );
    this.snapshotInFlight = null;
    this.nextFlushAt = now + HEATMAP_FIRST_FLUSH_MS;
  }

  recordClick(input: ClickInput): void {
    if (!this.active() || !this.buffer.currentPageViewId) return;
    this.classifier.add(input, this.now());
    this.watchEffects();
  }

  recordScroll(sample: ScrollSample | undefined): void {
    if (!sample || !this.active()) return;
    this.buffer.updateScroll(sample);
  }

  /** Visible response to a click: DOM mutation, URL change, scroll, focus. */
  noteEffect(): void {
    this.classifier.noteEffect(this.now());
  }

  noteError(): void {
    this.classifier.noteError(this.now());
  }

  tick(): void {
    const now = this.now();
    this.classifier.tick(now);
    if (!this.classifier.isWatchingEffects(now)) this.unwatchEffects();
    if (now >= this.nextFlushAt) {
      this.nextFlushAt = now + HEATMAP_FLUSH_MS;
      if (this.buffer.hasPending()) void this.flush();
    }
  }

  /** Page hidden / unloading: finalize every click and send with keepalive. */
  flushOnHide(): Promise<void> {
    this.classifier.flushAll(this.now());
    return this.flush({ keepalive: true });
  }

  flush(opts?: { keepalive?: boolean }): Promise<void> {
    this.flushChain = this.flushChain.then(
      () => this.flushOnce(opts),
      () => this.flushOnce(opts),
    );
    return this.flushChain;
  }

  disable(): void {
    this.killed = true;
    this.buffer.clear();
    this.classifier.clear();
    this.stop();
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.unwatchEffects();
    for (const teardown of this.teardowns.splice(0).reverse()) {
      try {
        teardown();
      } catch {
        // ignore
      }
    }
  }

  private async flushOnce(opts?: { keepalive?: boolean }): Promise<void> {
    if (!this.active()) {
      this.buffer.clear();
      return;
    }
    const transport = this.options.getTransport();
    if (!transport) return;
    this.buffer.setReplayId(this.options.getReplayId());
    const pageViews = this.buffer.drain(new Date(this.now()));
    if (pageViews.length === 0) return;

    const batches = chunkHeatmapPageViews(pageViews, {
      maxBytes: opts?.keepalive ? MAX_KEEPALIVE_BODY_BYTES : undefined,
    });
    for (const batch of batches) {
      if (!this.active()) return;
      try {
        const result = await ingestHeatmapBatch(transport, batch, opts);
        if (!result.enabled) {
          this.disable();
          return;
        }
        for (const id of result.snapshotRequests) this.scheduleSnapshot(id);
      } catch (error) {
        console.warn('@newtalaria/browser: heatmap ingest failed', error);
        const parsed = IngestError.fromUnknown(error);
        if (parsed.isGlobalCredentialFailure) {
          this.disable();
          this.options.onGlobalFailure(error);
          return;
        }
        if (parsed.isPermanent || parsed.isScopeOnly) {
          this.disable();
          return;
        }
      }
    }
  }

  private scheduleSnapshot(pageViewId: string): void {
    if (pageViewId !== this.buffer.currentPageViewId) return;
    if (this.snapshotInFlight === pageViewId) return;
    this.snapshotInFlight = pageViewId;

    const run = async () => {
      if (!this.active() || pageViewId !== this.buffer.currentPageViewId) return;
      const transport = this.options.getTransport();
      if (!transport) return;
      let captured: CapturedHeatmapSnapshot | null = null;
      try {
        captured = await (this.options.captureSnapshot ?? captureHeatmapSnapshot)({
          maskAllInputs: this.options.maskAllInputs,
          blockSelector: this.options.blockSelector,
        });
      } catch {
        return;
      }
      if (!captured || pageViewId !== this.buffer.currentPageViewId) return;
      try {
        await uploadHeatmapSnapshot(transport, {
          pageViewId,
          gzip: captured.gzip,
          viewportWidth: captured.viewportWidth,
          viewportHeight: captured.viewportHeight,
          documentHeight: captured.documentHeight,
          capturedAt: captured.capturedAt.toISOString(),
        });
      } catch (error) {
        console.warn('@newtalaria/browser: heatmap snapshot upload failed', error);
      }
    };

    if (this.options.headless || typeof document === 'undefined') {
      void run();
      return;
    }
    const afterSettle = () => {
      const t = setTimeout(() => {
        const idle = (
          globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
        ).requestIdleCallback;
        if (idle) idle(() => void run(), { timeout: SNAPSHOT_SETTLE_MS });
        else void run();
      }, SNAPSHOT_SETTLE_MS);
      this.teardowns.push(() => clearTimeout(t));
    };
    if (document.readyState === 'complete') {
      afterSettle();
    } else {
      window.addEventListener('load', afterSettle, { once: true });
      this.teardowns.push(() => window.removeEventListener('load', afterSettle));
    }
  }

  private watchEffects(): void {
    if (this.observer || typeof MutationObserver === 'undefined') return;
    if (typeof document === 'undefined') return;
    try {
      this.observer = new MutationObserver(() => this.noteEffect());
      this.observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    } catch {
      this.observer = null;
    }
  }

  private unwatchEffects(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private install(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const onClick = (ev: MouseEvent) => {
      try {
        const input = this.clickFromEvent(ev);
        if (input) this.recordClick(input);
      } catch {
        // Capture must never break the host page.
      }
    };
    const onPointerDown = (ev: PointerEvent) => {
      if (!this.active() || this.classifier.pendingCount === 0) return;
      try {
        const el = this.targetElement(ev);
        if (el) this.classifier.notePress(buildSelector(el as unknown as SelectorElement), this.now());
      } catch {
        // ignore
      }
    };
    const onScroll = () => {
      this.noteEffect();
      if (this.scrollFrame) return;
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = 0;
        this.recordScroll(readScrollSample());
      });
    };
    const onResize = () => this.recordScroll(readScrollSample());
    const onFocus = () => this.noteEffect();
    const onHide = () => {
      void this.flushOnHide();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };

    document.addEventListener('click', onClick, { capture: true, passive: true });
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('focusin', onFocus, true);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    this.teardowns.push(() => {
      document.removeEventListener('click', onClick, { capture: true });
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('focusin', onFocus, true);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = 0;
    });

    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Element a press is attributed to: blocked container, else the control. */
  private targetElement(ev: Event): Element | null {
    let target = ev.target as Element | null;
    if (target && target.nodeType !== 1) target = (target as Node).parentElement;
    if (!target || typeof target.getBoundingClientRect !== 'function') return null;
    const blocked = target.closest(this.blockSelector);
    if (blocked) return blocked;
    return target.closest(INTERACTIVE_SELECTOR) ?? target;
  }

  private clickFromEvent(ev: MouseEvent): ClickInput | null {
    if (!this.active()) return null;
    // Keyboard-activated clicks have no pointer position.
    if (ev.detail === 0 && ev.clientX === 0 && ev.clientY === 0) return null;
    const el = this.targetElement(ev);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;

    return {
      selector: buildSelector(el as unknown as SelectorElement),
      tag: el.tagName.toLowerCase(),
      relX: toBasisPoints(ev.clientX - rect.left, rect.width),
      relY: toBasisPoints(ev.clientY - rect.top, rect.height),
      pageX: Math.round(ev.clientX + window.scrollX),
      pageY: Math.round(ev.clientY + window.scrollY),
      clientX: ev.clientX,
      clientY: ev.clientY,
      deadEligible:
        !el.closest(FORM_LIKE_SELECTOR) && (selection == null || selection.isCollapsed),
    };
  }
}

export function toBasisPoints(offset: number, size: number): number {
  if (!(size > 0)) return 5_000;
  return Math.min(10_000, Math.max(0, Math.round((offset / size) * 10_000)));
}

export function readScrollSample(): ScrollSample | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  const docEl = document.documentElement;
  const body = document.body;
  return {
    scrollY: window.scrollY || docEl.scrollTop || 0,
    viewportWidth: window.innerWidth || docEl.clientWidth,
    viewportHeight: window.innerHeight || docEl.clientHeight,
    documentWidth: Math.max(docEl.scrollWidth, body?.scrollWidth ?? 0),
    documentHeight: Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0),
  };
}
