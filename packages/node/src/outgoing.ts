import type { TalariaNodeClient } from './client.js';
import { instrumentOutgoingFetch, instrumentOutgoingHttp } from './http.js';

const installed = new WeakSet<TalariaNodeClient>();

/**
 * Patch Node `http` / `https` once tracing is on.
 *
 * Project config arrives after init, so the patch waits for the tracer
 * instead of running only inside `init`. Talaria's own base URL is skipped.
 */
export function installOutgoingHttpInstrumentation(client: TalariaNodeClient): void {
  if (installed.has(client)) return;
  installed.add(client);
  let undo: (() => void) | null = null;
  client.onTracerReady((tracer) => {
    if (undo) return;
    const httpOpts = client.getHttpInstrumentOptions();
    if (!httpOpts) return;
    const httpOptsForPatch = {
      tracer,
      talariaBaseUrl: httpOpts.baseUrl,
      ignoreUrls: httpOpts.ignoreUrls,
    };
    const stopHttp = instrumentOutgoingHttp(httpOptsForPatch);
    const stopFetch = instrumentOutgoingFetch(httpOptsForPatch);
    const stop = () => {
      stopHttp();
      stopFetch();
    };
    undo = stop;
    client.addTeardown(() => {
      stop();
      undo = null;
    });
  });
}
