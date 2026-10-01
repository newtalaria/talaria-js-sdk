import { installConsentMode } from './consent_mode.js';
import { installCookiebot } from './cookiebot.js';
import { installCookieYes } from './cookieyes.js';
import type { MeasurementReporter } from './types.js';

/** Listen for CookieYes, Cookiebot, and Google Consent Mode. No second consent store. */
export function installConsentAdapters(handlers: {
  native: MeasurementReporter;
  consentMode: MeasurementReporter;
}): () => void {
  const stops = [
    installCookieYes(handlers.native),
    installCookiebot(handlers.native),
    installConsentMode(handlers.consentMode),
  ];
  return () => {
    for (const stop of stops) {
      try {
        stop();
      } catch {
        // Unhook must not break close.
      }
    }
  };
}
