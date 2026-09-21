import { defaultBlockSelector } from './privacy.js';
import type { RrwebEvent } from './segment_buffer.js';

export interface RecorderOptions {
  maskAllInputs: boolean;
  /** Embed accessible stylesheet rules into the snapshot. Default false at resolve time. */
  inlineStylesheet: boolean;
  blockSelector?: string;
  /**
   * Periodic Meta+FullSnapshot while recording (rrweb `checkoutEveryNms`).
   * Set in buffer/error-sample mode so the ring never ages out its paint base.
   */
  checkoutEveryNms?: number;
  onEvent: (event: RrwebEvent) => void;
}

export interface RecorderHandle {
  stop: () => void;
  /** Force Meta + FullSnapshot so the next replay has a paint base. */
  takeFullSnapshot: () => void;
}

type RrwebRecord = typeof import('rrweb').record;

/**
 * Start rrweb after a dynamic import so error-only bundles do not pay the
 * recorder cost until `Talaria.init` actually records.
 */
export function startRecorder(options: RecorderOptions): RecorderHandle {
  let cancelled = false;
  let stopFn: ReturnType<RrwebRecord> | undefined;
  let recordFn: RrwebRecord | undefined;

  void loadRrweb()
    .then((record) => {
      if (cancelled || typeof document === 'undefined' || !record) return;
      recordFn = record;
      try {
        stopFn = record({
          emit(event) {
            try {
              options.onEvent(event as RrwebEvent);
            } catch {
              // Snapshot/emit must not become a user-facing error.
            }
          },
          maskAllInputs: options.maskAllInputs,
          maskInputOptions: {
            password: true,
          },
          blockSelector: defaultBlockSelector(options.blockSelector),
          recordCanvas: false,
          collectFonts: false,
          inlineStylesheet: options.inlineStylesheet,
          slimDOMOptions: 'all',
          ...(options.checkoutEveryNms != null && options.checkoutEveryNms > 0
            ? { checkoutEveryNms: options.checkoutEveryNms }
            : {}),
          sampling: {
            mousemove: 150,
            scroll: 200,
            input: 'last',
          },
        });
      } catch {
        // Recording is optional — never crash the host.
      }
    })
    .catch(() => {
      // Dynamic import failed (offline / blocked). Stay silent.
    });

  return {
    stop: () => {
      cancelled = true;
      stopFn?.();
    },
    takeFullSnapshot: () => {
      try {
        recordFn?.takeFullSnapshot(true);
      } catch {
        // ignore
      }
    },
  };
}

async function loadRrweb(): Promise<RrwebRecord | undefined> {
  const mod = await import('rrweb');
  return mod.record;
}
