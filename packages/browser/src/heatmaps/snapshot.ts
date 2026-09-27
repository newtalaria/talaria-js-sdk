import { sanitizeTelemetryUrl } from '@newtalaria/core';
import { defaultBlockSelector } from '../replay/privacy.js';
import { gzipBytes } from '../utils/gzip.js';

/** rrweb event types the dashboard viewer replays (Meta + FullSnapshot). */
const RRWEB_META = 4;
const RRWEB_FULL_SNAPSHOT = 2;

export interface HeatmapSnapshotOptions {
  maskAllInputs: boolean;
  blockSelector?: string;
}

export interface CapturedHeatmapSnapshot {
  gzip: Uint8Array;
  viewportWidth: number;
  viewportHeight: number;
  documentHeight: number;
  capturedAt: Date;
}

/** Build the two-event rrweb stream the viewer rebuilds. */
export function buildSnapshotEvents(args: {
  node: unknown;
  href: string;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  timestamp: number;
}): unknown[] {
  return [
    {
      type: RRWEB_META,
      data: { href: args.href, width: args.width, height: args.height },
      timestamp: args.timestamp,
    },
    {
      type: RRWEB_FULL_SNAPSHOT,
      data: {
        node: args.node,
        initialOffset: { left: args.scrollX, top: args.scrollY },
      },
      timestamp: args.timestamp,
    },
  ];
}

/**
 * Serialize the current document with the replay masking rules. Stylesheets
 * are inlined where readable so the backdrop survives the next deploy.
 * Uses a standalone `rrweb-snapshot` mirror so it never disturbs an active
 * replay recording.
 */
export async function captureHeatmapSnapshot(
  options: HeatmapSnapshotOptions,
): Promise<CapturedHeatmapSnapshot | null> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }
  const mod = await import('rrweb-snapshot');
  const node = mod.snapshot(document, {
    mirror: mod.createMirror(),
    blockSelector: defaultBlockSelector(options.blockSelector),
    maskAllInputs: options.maskAllInputs ? true : { password: true },
    inlineStylesheet: true,
    slimDOM: 'all',
    recordCanvas: false,
    inlineImages: false,
  });
  if (!node) return null;

  const docEl = document.documentElement;
  const viewportWidth = window.innerWidth || docEl.clientWidth;
  const viewportHeight = window.innerHeight || docEl.clientHeight;
  const documentHeight = Math.max(
    docEl.scrollHeight,
    document.body?.scrollHeight ?? 0,
    viewportHeight,
  );
  const capturedAt = new Date();
  const events = buildSnapshotEvents({
    node,
    href: sanitizeTelemetryUrl(window.location.href),
    width: viewportWidth,
    height: viewportHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    timestamp: capturedAt.getTime(),
  });
  const gzip = await gzipBytes(new TextEncoder().encode(JSON.stringify(events)));
  return { gzip, viewportWidth, viewportHeight, documentHeight, capturedAt };
}
