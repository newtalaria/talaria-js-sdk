import { Talaria } from '@newtalaria/browser';

export interface ReactErrorInfo {
  errorBoundary?: unknown;
  componentStack?: string | null;
}

/**
 * React 19 `createRoot` / `hydrateRoot` error hook helper.
 *
 * ```ts
 * createRoot(el, {
 *   onUncaughtError: Talaria.reactErrorHandler(),
 *   onCaughtError: Talaria.reactErrorHandler(),
 *   onRecoverableError: Talaria.reactErrorHandler(),
 * });
 * ```
 */
export function reactErrorHandler(
  after?: (error: unknown, errorInfo: ReactErrorInfo) => void,
): (error: unknown, errorInfo: ReactErrorInfo) => void {
  return (error, errorInfo) => {
    void Talaria.captureException(error, {
      mechanism: { type: 'react', handled: false },
      extra: {
        componentStack: errorInfo.componentStack ?? '',
      },
    });
    after?.(error, errorInfo);
  };
}
