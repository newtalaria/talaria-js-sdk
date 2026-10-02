import { onCLS, onINP, onLCP, onTTFB, type MetricType } from 'web-vitals';
import type { Teardown } from '../replay/hooks.js';

export type WebVitalName = 'lcp' | 'inp' | 'cls' | 'ttfb';

export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

export interface WebVital {
  name: WebVitalName;
  value: number;
  at: Date;
  delta?: number;
  id?: string;
  rating?: WebVitalRating;
  navigationType?: string;
}

const THRESHOLDS: Record<WebVitalName, [number, number]> = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
  ttfb: [800, 1800],
};

export function rateWebVital(name: WebVitalName, value: number): WebVitalRating {
  const [good, needsImprovement] = THRESHOLDS[name];
  if (value <= good) return 'good';
  if (value <= needsImprovement) return 'needs-improvement';
  return 'poor';
}

export function vitalFromMetric(metric: MetricType): WebVital | null {
  const name = metric.name.toLowerCase();
  if (name !== 'lcp' && name !== 'inp' && name !== 'cls' && name !== 'ttfb') {
    return null;
  }
  return {
    name,
    value: metric.value,
    at: new Date(),
    delta: metric.delta,
    id: metric.id,
    rating: metric.rating,
    navigationType: metric.navigationType,
  };
}

/**
 * One final LCP, INP, CLS, and TTFB sample per document load.
 * `web-vitals` reports each metric when Chrome considers it final.
 */
export function installWebVitals(onVital: (vital: WebVital) => void): Teardown {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return () => {};
  }

  let stopped = false;
  const report = (metric: MetricType): void => {
    if (stopped) return;
    const vital = vitalFromMetric(metric);
    if (!vital) return;
    onVital(vital);
  };

  onLCP(report);
  onINP(report);
  onCLS(report);
  onTTFB(report);

  return () => {
    stopped = true;
  };
}
