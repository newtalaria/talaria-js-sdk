import {
  ingestEventBatch,
  type IngestEventParams,
} from './events.js';
import type { ServerpodTransport } from './serverpod.js';

/** Match PHP and Dart: 50 events or 2 seconds. */
export const MAX_EVENT_BATCH = 50;
export const EVENT_FLUSH_INTERVAL_MS = 2000;

/**
 * Buffers error/log events and posts them as one `events/ingestBatch`.
 * A `keepalive` event (page hide) flushes immediately.
 */
export class EventIngestQueue {
  private buffer: IngestEventParams[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private disabled = false;

  constructor(
    private readonly send: (
      events: IngestEventParams[],
      opts?: { keepalive?: boolean },
    ) => Promise<void>,
    private readonly onError?: (error: unknown) => void,
  ) {}

  static forTransport(
    transport: ServerpodTransport,
    onError?: (error: unknown) => void,
  ): EventIngestQueue {
    return new EventIngestQueue(async (events, opts) => {
      await ingestEventBatch(transport, events, opts);
    }, onError);
  }

  enqueue(event: IngestEventParams): Promise<void> {
    if (this.disabled) return Promise.resolve();
    this.buffer.push(event);
    if (event.keepalive || this.buffer.length >= MAX_EVENT_BATCH) {
      return this.flush({ keepalive: Boolean(event.keepalive) });
    }
    this.arm();
    return Promise.resolve();
  }

  flush(opts?: { keepalive?: boolean }): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.chain = this.chain.then(() => this.drain(opts));
    return this.chain;
  }

  disable(): void {
    this.disabled = true;
    this.buffer = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private arm(): void {
    if (this.timer || this.disabled) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, EVENT_FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  private async drain(opts?: { keepalive?: boolean }): Promise<void> {
    while (this.buffer.length > 0 && !this.disabled) {
      const batch = this.buffer.splice(0, MAX_EVENT_BATCH);
      const keepalive = opts?.keepalive ?? batch.some((event) => event.keepalive);
      try {
        await this.send(batch, { keepalive });
      } catch (error) {
        this.onError?.(error);
      }
    }
  }
}
