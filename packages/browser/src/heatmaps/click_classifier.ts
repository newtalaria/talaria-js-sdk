/**
 * Rage / dead / error classification for heatmap clicks. Pure state machine:
 * the DOM layer reports clicks, visible effects, and captured errors with a
 * timestamp; clicks are finalized once their observation window closes.
 */

export const RAGE_WINDOW_MS = 1_000;
export const RAGE_RADIUS_PX = 30;
export const RAGE_MIN_CLICKS = 3;
export const DEAD_WINDOW_MS = 1_000;
export const ERROR_WINDOW_MS = 2_000;
/** A click is final once every window that can still flag it has closed. */
export const CLICK_FINALIZE_MS = ERROR_WINDOW_MS;

export interface ClickInput {
  selector: string;
  tag: string;
  relX: number;
  relY: number;
  pageX: number;
  pageY: number;
  clientX: number;
  clientY: number;
  /** False for form fields, labels, and clicks that leave a text selection. */
  deadEligible: boolean;
}

export interface ClassifiedClick {
  selector: string;
  tag: string;
  relX: number;
  relY: number;
  pageX: number;
  pageY: number;
  occurredAt: number;
  rage: boolean;
  dead: boolean;
  error: boolean;
}

interface PendingClick {
  input: ClickInput;
  at: number;
  /** Effects after this belong to a later click on another element. */
  observeUntil: number;
  rage: boolean;
  effect: boolean;
  error: boolean;
}

export class ClickClassifier {
  private pending: PendingClick[] = [];

  constructor(private readonly onFinalized: (click: ClassifiedClick) => void) {}

  get pendingCount(): number {
    return this.pending.length;
  }

  /** True while any click still needs DOM-effect observation. */
  isWatchingEffects(now: number): boolean {
    return this.pending.some((p) => !p.effect && now <= p.observeUntil);
  }

  /**
   * A new press started on [selector]. Focus and other effects of that press
   * fire before its click event, so earlier clicks on other elements stop
   * observing now.
   */
  notePress(selector: string, at: number): void {
    for (const p of this.pending) {
      if (p.input.selector !== selector && p.observeUntil > at) {
        p.observeUntil = at;
      }
    }
  }

  add(input: ClickInput, at: number): void {
    this.notePress(input.selector, at);
    const click: PendingClick = {
      input,
      at,
      observeUntil: at + DEAD_WINDOW_MS,
      rage: false,
      effect: false,
      error: false,
    };
    this.pending.push(click);
    this.markRage(click);
  }

  /** DOM mutation, URL change, scroll, or focus change. */
  noteEffect(at: number): void {
    for (const p of this.pending) {
      if (at >= p.at && at < p.observeUntil) p.effect = true;
    }
  }

  noteError(at: number): void {
    for (const p of this.pending) {
      if (at >= p.at && at - p.at <= ERROR_WINDOW_MS) p.error = true;
    }
  }

  /** Finalize clicks whose windows have closed. */
  tick(now: number): void {
    const keep: PendingClick[] = [];
    for (const p of this.pending) {
      if (now - p.at >= CLICK_FINALIZE_MS) this.emit(p, true);
      else keep.push(p);
    }
    this.pending = keep;
  }

  /** Page is going away — emit everything. Dead only when its window closed. */
  flushAll(now: number): void {
    for (const p of this.pending) this.emit(p, now >= p.observeUntil);
    this.pending = [];
  }

  clear(): void {
    this.pending = [];
  }

  private markRage(latest: PendingClick): void {
    const recent = this.pending.filter(
      (p) => latest.at - p.at <= RAGE_WINDOW_MS,
    );
    for (const first of recent) {
      const burst = recent.filter(
        (p) =>
          p.at >= first.at &&
          p.at - first.at <= RAGE_WINDOW_MS &&
          distance(p.input, first.input) <= RAGE_RADIUS_PX,
      );
      if (burst.length >= RAGE_MIN_CLICKS && burst.includes(latest)) {
        for (const p of burst) p.rage = true;
        return;
      }
    }
  }

  private emit(p: PendingClick, deadWindowClosed: boolean): void {
    this.onFinalized({
      selector: p.input.selector,
      tag: p.input.tag,
      relX: p.input.relX,
      relY: p.input.relY,
      pageX: p.input.pageX,
      pageY: p.input.pageY,
      occurredAt: p.at,
      rage: p.rage,
      dead: p.input.deadEligible && deadWindowClosed && !p.effect,
      error: p.error,
    });
  }
}

function distance(a: ClickInput, b: ClickInput): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
