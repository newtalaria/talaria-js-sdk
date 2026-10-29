import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exceptionTitle, MAX_TITLE_LENGTH } from '../src/utils/exception_title.ts';
import { TalariaClient } from '../src/client.ts';

describe('exceptionTitle', () => {
  it('is "<Type>: <message>"', () => {
    assert.equal(exceptionTitle('TypeError', "Cannot read properties of undefined (reading 'orders')"), "TypeError: Cannot read properties of undefined (reading 'orders')");
    assert.equal(exceptionTitle('HttpError', 'HTTP 504: POST https://x/api/checkout'), 'HttpError: HTTP 504: POST https://x/api/checkout');
  });
  it('falls back to the type, keeps the first line, avoids doubling and truncates', () => {
    assert.equal(exceptionTitle('TimeoutError', ''), 'TimeoutError');
    assert.equal(exceptionTitle('', undefined), 'Error');
    assert.equal(exceptionTitle('Error', 'Error'), 'Error');
    assert.equal(exceptionTitle('E', 'line one\nline two'), 'E: line one');
    assert.equal(exceptionTitle('E', 'E: already'), 'E: already');
    const long = exceptionTitle('E', 'x'.repeat(500));
    assert.equal(long.length, MAX_TITLE_LENGTH);
    assert.ok(long.endsWith('…'));
  });
});

describe('replays/start failure', () => {
  it('does not reject (no unhandled rejection -> no TransportError issue) and leaves the replay unstarted', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(String(args[0])); };
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const client = new TalariaClient();
      client.init({ url: 'http://localhost:8080', apiKey: 'tal_pk_test_nz1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1zu896', replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0, disableDefaultIntegrations: true });
      const any = client as unknown as {
        transport: { call: (...a: unknown[]) => Promise<unknown> };
        replayId: string | null; sessionId: string | null; startedOnServer: boolean; replayDisabled: boolean;
        ensureStarted: (o: { keepalive: boolean }) => Promise<void>;
        enqueueUpload: (t: () => Promise<void>) => Promise<void>;
      };
      any.transport.call = async () => { throw new Error('Talaria replays/start failed: HTTP 429'); };
      any.replayId = 'r1'; any.sessionId = 's1'; any.startedOnServer = false; any.replayDisabled = false;
      await assert.doesNotReject(any.ensureStarted({ keepalive: false }));
      assert.equal(any.startedOnServer, false);
      await assert.doesNotReject(any.enqueueUpload(async () => { throw new Error('boom'); }));
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(unhandled.length, 0);
      assert.ok(warnings.some((w) => w.includes('replays/start failed')));
      await client.close();
    } finally {
      console.warn = originalWarn;
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
