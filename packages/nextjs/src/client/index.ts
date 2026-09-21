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
 */
export function initClient(options: TalariaInitOptions): void {
  Talaria.init(options);
  if (typeof window === 'undefined') return;
  let last = window.location.pathname;
  const notify = () => {
    const path = window.location.pathname;
    if (path === last) return;
    last = path;
    Talaria.startNavigation({
      name: path,
      url: window.location.href,
    });
  };
  window.addEventListener('popstate', notify);
}

export default Talaria;
