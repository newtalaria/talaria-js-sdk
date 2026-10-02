import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  installWebVitals,
  rateWebVital,
  vitalFromMetric,
} from '../src/integrations/web_vitals.ts';
import type { MetricType } from 'web-vitals';

describe('web vitals observer', () => {
  it('no-ops when PerformanceObserver is missing', () => {
    const original = globalThis.PerformanceObserver;
    // @ts-expect-error test double
    globalThis.PerformanceObserver = undefined;
    try {
      const seen: string[] = [];
      const stop = installWebVitals((v) => seen.push(v.name));
      stop();
      assert.deepEqual(seen, []);
    } finally {
      globalThis.PerformanceObserver = original;
    }
  });

  it('maps LCP, INP, CLS, and TTFB and drops FCP', () => {
    const lcp = vitalFromMetric(metric('LCP', 1234, 'good'));
    const inp = vitalFromMetric(metric('INP', 80, 'good'));
    const cls = vitalFromMetric(metric('CLS', 0.05, 'good'));
    const ttfb = vitalFromMetric(metric('TTFB', 400, 'good'));
    const fcp = vitalFromMetric(metric('FCP', 100, 'good'));
    assert.equal(fcp, null);
    assert.deepEqual(
      [lcp, inp, cls, ttfb].map((vital) => vital && { name: vital.name, value: vital.value }),
      [
        { name: 'lcp', value: 1234 },
        { name: 'inp', value: 80 },
        { name: 'cls', value: 0.05 },
        { name: 'ttfb', value: 400 },
      ],
    );
    assert.equal(lcp?.rating, 'good');
    assert.equal(lcp?.id, 'id-LCP');
    assert.equal(lcp?.navigationType, 'navigate');
  });

  it('rates values on Chrome thresholds', () => {
    assert.equal(rateWebVital('lcp', 2500), 'good');
    assert.equal(rateWebVital('lcp', 4000), 'needs-improvement');
    assert.equal(rateWebVital('lcp', 4001), 'poor');
    assert.equal(rateWebVital('inp', 200), 'good');
    assert.equal(rateWebVital('cls', 0.25), 'needs-improvement');
    assert.equal(rateWebVital('ttfb', 1801), 'poor');
  });
});

function metric(
  name: MetricType['name'],
  value: number,
  rating: 'good' | 'needs-improvement' | 'poor',
): MetricType {
  return {
    name,
    value,
    delta: value,
    id: `id-${name}`,
    rating,
    navigationType: 'navigate',
    entries: [],
    navigationId: 1,
  } as MetricType;
}
