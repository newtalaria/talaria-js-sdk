import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVENT_FLUSH_INTERVAL_MS,
  EventIngestQueue,
  MAX_EVENT_BATCH,
} from '../src/transport/event_queue.ts';
import type { IngestEventParams } from '../src/transport/events.ts';

function event(message: string): IngestEventParams {
  return { message };
}

describe('EventIngestQueue', () => {
  it('holds a single event until flush', async () => {
    const sent: string[][] = [];
    const queue = new EventIngestQueue(async (events) => {
      sent.push(events.map((item) => item.message));
    });
    await queue.enqueue(event('one'));
    assert.equal(sent.length, 0);
    await queue.flush();
    assert.deepEqual(sent, [['one']]);
    queue.disable();
  });

  it('flushes when the batch reaches 50', async () => {
    const sent: number[] = [];
    const queue = new EventIngestQueue(async (events) => {
      sent.push(events.length);
    });
    for (let i = 0; i < MAX_EVENT_BATCH; i++) {
      await queue.enqueue(event(`e${i}`));
    }
    assert.deepEqual(sent, [MAX_EVENT_BATCH]);
    assert.equal(EVENT_FLUSH_INTERVAL_MS, 2000);
  });

  it('flushes a keepalive event immediately', async () => {
    const sent: boolean[] = [];
    const queue = new EventIngestQueue(async (events, opts) => {
      sent.push(Boolean(opts?.keepalive));
      assert.equal(events.length, 1);
    });
    await queue.enqueue({ ...event('bye'), keepalive: true });
    assert.deepEqual(sent, [true]);
  });
});
