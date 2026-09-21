export {
  ErrorBoundary,
  Profiler,
  Talaria,
  instrumentReactRouter,
  reactErrorHandler,
  withProfiler,
} from '@newtalaria/react';

export type {
  Breadcrumb,
  CaptureContext,
  SeverityLevel,
  Span,
  TalariaInitOptions,
  UserContext,
} from '@newtalaria/react';

import { Talaria } from '@newtalaria/react';
import type { TalariaInitOptions } from '@newtalaria/react';

/**
 * Call from `instrumentation-client.ts`.
 * Records App Router navigations when `location` changes after init.
 * The browser SDK already wraps `history.pushState` / `replaceState`;
 * this also covers `popstate` and the Navigation API if Next.js bypasses History.
 */
export function initClient(options: TalariaInitOptions): void {
  Talaria.init(options);
  const win = globalThis.window;
  if (typeof win === 'undefined') return;
  let last = win.location.pathname;
  const notify = () => {
    const path = win.location.pathname;
    if (path === last) return;
    last = path;
    Talaria.startNavigation({
      name: path,
      url: win.location.href,
    });
  };
  win.addEventListener('popstate', notify);
  const navigation = (
    win as Window & {
      navigation?: { addEventListener?: (type: string, listener: () => void) => void };
    }
  ).navigation;
  navigation?.addEventListener?.('currentchange', notify);
}

export default Talaria;
