import type { MeasurementReporter, MeasurementSignal } from './types.js';

type DataLayer = unknown[] & {
  push: (...args: unknown[]) => number;
};

type ConsentHost = {
  dataLayer?: DataLayer;
};

/**
 * Google Consent Mode `analytics_storage` on `dataLayer` consent default/update.
 * OneTrust and Usercentrics are read through this signal. Ad storage is ignored.
 * Group ids and service names are not guessed.
 */
export function signalFromConsentModeEntry(entry: unknown): MeasurementSignal | null {
  if (entry == null || typeof entry !== 'object') return null;
  const record = entry as { 0?: unknown; 1?: unknown; 2?: unknown };
  if (record[0] !== 'consent') return null;
  if (record[1] !== 'default' && record[1] !== 'update') return null;
  const params = record[2];
  if (!params || typeof params !== 'object') return null;
  const storage = (params as { analytics_storage?: unknown }).analytics_storage;
  if (storage === 'granted') return 'granted';
  if (storage === 'denied') return 'denied';
  return null;
}

export function installConsentMode(report: MeasurementReporter): () => void {
  const host = globalThis as ConsentHost & { window?: unknown };
  if (host.dataLayer == null && typeof host.window === 'undefined') {
    return () => undefined;
  }
  if (!host.dataLayer) {
    host.dataLayer = [] as unknown as DataLayer;
  }
  const layer = host.dataLayer;
  if (typeof layer.push !== 'function') return () => undefined;

  for (const entry of layer) {
    const signal = signalFromConsentModeEntry(entry);
    if (signal) report(signal);
  }

  const original = layer.push.bind(layer);
  const wrapped = function (this: DataLayer, ...args: unknown[]): number {
    const result = original(...args);
    for (const arg of args) {
      const signal = signalFromConsentModeEntry(arg);
      if (signal) report(signal);
    }
    return result;
  };
  layer.push = wrapped;
  return () => {
    if (layer.push === wrapped) layer.push = original;
  };
}
