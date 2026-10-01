import type { MeasurementReporter, MeasurementSignal } from './types.js';

type CookiebotGlobal = {
  consent?: { statistics?: unknown };
  hasResponse?: unknown;
  declined?: unknown;
};

type CookiebotTarget = {
  addEventListener: (type: string, handler: (event: Event) => void) => void;
  removeEventListener: (type: string, handler: (event: Event) => void) => void;
};

/**
 * Cookiebot statistics category. Necessary, preferences, and marketing do not
 * grant measurement. `CookiebotOnConsentReady`, `CookiebotOnAccept`, and
 * `CookiebotOnDecline` also fire when a stored choice is loaded.
 */
export function signalFromCookiebot(bot: CookiebotGlobal | undefined): MeasurementSignal | null {
  if (!bot || typeof bot !== 'object') return null;
  if (bot.consent?.statistics === true) return 'granted';
  if (bot.declined === true || bot.hasResponse === true) return 'denied';
  return 'pending';
}

export function installCookiebot(report: MeasurementReporter): () => void {
  const host = cookiebotHost();
  const initial = signalFromCookiebot(host?.Cookiebot);
  if (initial) report(initial);

  const target = eventTarget(host);
  if (!target) return () => undefined;

  const onReady = () => {
    const signal = signalFromCookiebot(cookiebotHost()?.Cookiebot);
    if (signal) report(signal);
  };
  target.addEventListener('CookiebotOnConsentReady', onReady);
  target.addEventListener('CookiebotOnAccept', onReady);
  target.addEventListener('CookiebotOnDecline', onReady);
  return () => {
    target.removeEventListener('CookiebotOnConsentReady', onReady);
    target.removeEventListener('CookiebotOnAccept', onReady);
    target.removeEventListener('CookiebotOnDecline', onReady);
  };
}

function cookiebotHost(): (CookiebotTarget & { Cookiebot?: CookiebotGlobal }) | null {
  const host = globalThis as CookiebotTarget & { Cookiebot?: CookiebotGlobal };
  if (host.Cookiebot || typeof host.addEventListener === 'function') return host;
  const win = (globalThis as { window?: CookiebotTarget & { Cookiebot?: CookiebotGlobal } }).window;
  if (win && (win.Cookiebot || typeof win.addEventListener === 'function')) return win;
  return null;
}

function eventTarget(
  host: (CookiebotTarget & { Cookiebot?: CookiebotGlobal }) | null,
): CookiebotTarget | null {
  if (host && typeof host.addEventListener === 'function' && typeof host.removeEventListener === 'function') {
    return host;
  }
  const win = (globalThis as { window?: CookiebotTarget }).window;
  if (
    win &&
    typeof win.addEventListener === 'function' &&
    typeof win.removeEventListener === 'function'
  ) {
    return win;
  }
  return null;
}
