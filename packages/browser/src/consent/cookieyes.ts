import type { MeasurementReporter, MeasurementSignal } from './types.js';

type CookieYesCategories = {
  analytics?: unknown;
};

type CookieYesState = {
  categories?: CookieYesCategories;
  isUserActionCompleted?: unknown;
};

type CookieYesUpdate = {
  accepted?: unknown;
};

type CookieYesGlobals = {
  getCkyConsent?: () => unknown;
};

/**
 * CookieYes analytics category.
 * `cookieyes_banner_load` / `getCkyConsent` carry `categories.analytics`.
 * `cookieyes_consent_update` carries `accepted`, and the id stays `analytics`
 * even when the banner label is renamed.
 */
export function signalFromCookieYesState(detail: unknown): MeasurementSignal | null {
  if (!detail || typeof detail !== 'object') return null;
  const state = detail as CookieYesState;
  const categories = state.categories;
  if (!categories || typeof categories !== 'object') return null;
  if (categories.analytics === true) return 'granted';
  if (state.isUserActionCompleted === true) return 'denied';
  return 'pending';
}

export function signalFromCookieYesUpdate(detail: unknown): MeasurementSignal | null {
  if (!detail || typeof detail !== 'object') return null;
  const accepted = (detail as CookieYesUpdate).accepted;
  if (!Array.isArray(accepted)) return null;
  return accepted.includes('analytics') ? 'granted' : 'denied';
}

export function installCookieYes(report: MeasurementReporter): () => void {
  const globals = globalThis as CookieYesGlobals;
  if (typeof globals.getCkyConsent === 'function') {
    try {
      const signal = signalFromCookieYesState(globals.getCkyConsent());
      if (signal) report(signal);
    } catch {
      // Banner read must not break init.
    }
  }

  const doc = globalThis.document;
  if (!doc || typeof doc.addEventListener !== 'function') return () => undefined;

  const onLoad = (event: Event) => {
    const signal = signalFromCookieYesState(detailOf(event));
    if (signal) report(signal);
  };
  const onUpdate = (event: Event) => {
    const signal = signalFromCookieYesUpdate(detailOf(event));
    if (signal) report(signal);
  };
  doc.addEventListener('cookieyes_banner_load', onLoad);
  doc.addEventListener('cookieyes_consent_update', onUpdate);
  return () => {
    doc.removeEventListener('cookieyes_banner_load', onLoad);
    doc.removeEventListener('cookieyes_consent_update', onUpdate);
  };
}

function detailOf(event: Event): unknown {
  return (event as Event & { detail?: unknown }).detail;
}
