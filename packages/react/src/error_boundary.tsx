import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Talaria } from '@newtalaria/browser';

export type ErrorBoundaryFallback =
  | ReactNode
  | ((error: Error, reset: () => void) => ReactNode);

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ErrorBoundaryFallback;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Capture React render errors and show an optional fallback.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void Talaria.captureException(error, {
      mechanism: { type: 'react', handled: true },
      extra: {
        componentStack: info.componentStack ?? '',
      },
    });
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const fallback = this.props.fallback;
    if (typeof fallback === 'function') return fallback(error, this.reset);
    if (fallback) return fallback;
    return null;
  }
}
