import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ScrollTracker, scrollReachPct } from '../src/heatmaps/scroll_tracker.ts';

const base = {
  scrollY: 0,
  viewportWidth: 390,
  viewportHeight: 800,
  documentWidth: 390,
  documentHeight: 4000,
};

describe('heatmap scroll tracker', () => {
  it('records the initial fold and max depth', () => {
    const t = new ScrollTracker();
    t.update(base);
    t.update({ ...base, scrollY: 1200 });
    t.update({ ...base, scrollY: 400 });
    const s = t.snapshot()!;
    assert.equal(s.initialFoldPx, 800);
    assert.equal(s.maxScrollDepthPx, 2000);
    assert.equal(scrollReachPct(s), 50);
  });

  it('keeps the tallest document height when content loads late', () => {
    const t = new ScrollTracker();
    t.update(base);
    t.update({ ...base, documentHeight: 8000, scrollY: 7200 });
    const s = t.snapshot()!;
    assert.equal(s.documentHeight, 8000);
    assert.equal(scrollReachPct(s), 100);
  });

  it('treats a page that does not scroll as fully reached', () => {
    const t = new ScrollTracker();
    t.update({ ...base, documentHeight: 600 });
    assert.equal(scrollReachPct(t.snapshot()!), 100);
  });

  it('is dirty only when something changes', () => {
    const t = new ScrollTracker();
    t.update(base);
    assert.equal(t.isDirty(), true);
    t.markSent();
    t.update({ ...base, scrollY: 0 });
    assert.equal(t.isDirty(), false);
    t.update({ ...base, scrollY: 100 });
    assert.equal(t.isDirty(), true);
  });
});
