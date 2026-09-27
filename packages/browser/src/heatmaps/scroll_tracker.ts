/**
 * Scroll reach for one pageview, measured on document (window) scrolling.
 * Depth is the lowest visible pixel (`scrollY + viewportHeight`); the server
 * turns it into a percentage of the tallest document height seen.
 */

export interface ScrollSample {
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
}

export interface ScrollState {
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
  maxScrollDepthPx: number;
  initialFoldPx: number;
}

export class ScrollTracker {
  private state: ScrollState | null = null;
  private dirty = false;

  update(sample: ScrollSample): void {
    const viewportHeight = Math.max(0, Math.round(sample.viewportHeight));
    const documentHeight = Math.max(
      viewportHeight,
      Math.round(sample.documentHeight),
    );
    const depth = Math.min(
      documentHeight,
      Math.round(Math.max(0, sample.scrollY) + viewportHeight),
    );

    if (!this.state) {
      this.state = {
        viewportWidth: Math.round(sample.viewportWidth),
        viewportHeight,
        documentWidth: Math.round(sample.documentWidth),
        documentHeight,
        maxScrollDepthPx: depth,
        initialFoldPx: Math.min(viewportHeight, documentHeight),
      };
      this.dirty = true;
      return;
    }

    const s = this.state;
    const next: ScrollState = {
      viewportWidth: Math.round(sample.viewportWidth),
      viewportHeight,
      documentWidth: Math.max(s.documentWidth, Math.round(sample.documentWidth)),
      documentHeight: Math.max(s.documentHeight, documentHeight),
      maxScrollDepthPx: Math.max(s.maxScrollDepthPx, depth),
      initialFoldPx: s.initialFoldPx,
    };
    if (
      next.maxScrollDepthPx !== s.maxScrollDepthPx ||
      next.documentHeight !== s.documentHeight ||
      next.documentWidth !== s.documentWidth ||
      next.viewportWidth !== s.viewportWidth ||
      next.viewportHeight !== s.viewportHeight
    ) {
      this.dirty = true;
    }
    this.state = next;
  }

  snapshot(): ScrollState | null {
    return this.state ? { ...this.state } : null;
  }

  /** Changed since the last {@link markSent}. */
  isDirty(): boolean {
    return this.dirty;
  }

  markSent(): void {
    this.dirty = false;
  }
}

/** Percentage of the page reached (0–100). Non-scrolling pages are 100%. */
export function scrollReachPct(state: ScrollState): number {
  if (state.documentHeight <= 0) return 100;
  return Math.min(
    100,
    Math.round((state.maxScrollDepthPx / state.documentHeight) * 100),
  );
}
