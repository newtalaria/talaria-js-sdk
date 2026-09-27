import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ClickClassifier,
  type ClassifiedClick,
  type ClickInput,
} from '../src/heatmaps/click_classifier.ts';
import { HeatmapBuffer, MAX_CLICKS_PER_PAGEVIEW } from '../src/heatmaps/heatmap_buffer.ts';

function click(x: number, y: number, over?: Partial<ClickInput>): ClickInput {
  return {
    selector: 'body > button',
    tag: 'button',
    relX: 5000,
    relY: 5000,
    pageX: x,
    pageY: y,
    clientX: x,
    clientY: y,
    deadEligible: true,
    ...over,
  };
}

function collect(): { out: ClassifiedClick[]; classifier: ClickClassifier } {
  const out: ClassifiedClick[] = [];
  return { out, classifier: new ClickClassifier((c) => out.push(c)) };
}

describe('heatmap click classifier', () => {
  it('flags three quick clicks in a small area as rage', () => {
    const { out, classifier } = collect();
    classifier.add(click(100, 100), 0);
    classifier.add(click(110, 105), 300);
    classifier.add(click(95, 98), 600);
    classifier.add(click(400, 400), 700);
    classifier.tick(5_000);
    assert.deepEqual(
      out.map((c) => c.rage),
      [true, true, true, false],
    );
  });

  it('does not flag slow or spread-out clicks as rage', () => {
    const { out, classifier } = collect();
    classifier.add(click(100, 100), 0);
    classifier.add(click(100, 100), 600);
    classifier.add(click(100, 100), 1_300);
    classifier.add(click(300, 300), 1_400);
    classifier.tick(10_000);
    assert.equal(out.some((c) => c.rage), false);
  });

  it('marks a click dead when nothing reacts within 1s', () => {
    const { out, classifier } = collect();
    classifier.add(click(10, 10), 0);
    classifier.add(click(50, 50), 5_000);
    classifier.noteEffect(5_400);
    classifier.add(click(90, 90, { deadEligible: false }), 9_000);
    classifier.tick(20_000);
    assert.deepEqual(
      out.map((c) => c.dead),
      [true, false, false],
    );
  });

  it('credits an effect to the latest click on another element', () => {
    const { out, classifier } = collect();
    classifier.add(click(10, 10, { selector: '.static' }), 0);
    classifier.add(click(300, 300, { selector: '#link' }), 200);
    classifier.noteEffect(250);
    classifier.tick(5_000);
    assert.deepEqual(
      out.map((c) => c.dead),
      [true, false],
    );
  });

  it('stops observing when a press starts on another element', () => {
    const { out, classifier } = collect();
    classifier.add(click(10, 10, { selector: '.static' }), 0);
    classifier.notePress('#link', 200);
    // Focus from the new press lands in the same millisecond.
    classifier.noteEffect(200);
    classifier.noteEffect(220);
    classifier.tick(5_000);
    assert.equal(out[0]!.dead, true);
  });

  it('keeps observing repeat clicks on the same element', () => {
    const { out, classifier } = collect();
    classifier.add(click(10, 10), 0);
    classifier.add(click(12, 11), 200);
    classifier.noteEffect(400);
    classifier.tick(5_000);
    assert.deepEqual(
      out.map((c) => c.dead),
      [false, false],
    );
  });

  it('ignores effects outside the dead window', () => {
    const { out, classifier } = collect();
    classifier.add(click(10, 10), 0);
    classifier.noteEffect(1_500);
    classifier.tick(3_000);
    assert.equal(out[0]!.dead, true);
  });

  it('flags clicks followed by an error within 2s', () => {
    const { out, classifier } = collect();
    classifier.add(click(10, 10), 0);
    classifier.add(click(20, 20), 5_000);
    classifier.noteError(1_800);
    classifier.tick(20_000);
    assert.deepEqual(
      out.map((c) => c.error),
      [true, false],
    );
  });

  it('keeps clicks pending until the error window closes', () => {
    const { out, classifier } = collect();
    classifier.add(click(10, 10), 0);
    classifier.tick(1_500);
    assert.equal(out.length, 0);
    assert.equal(classifier.pendingCount, 1);
    classifier.tick(2_000);
    assert.equal(out.length, 1);
  });

  it('flushAll only marks dead once the dead window has closed', () => {
    const { out, classifier } = collect();
    classifier.add(click(10, 10), 0);
    classifier.add(click(200, 200), 1_700);
    classifier.flushAll(2_000);
    assert.deepEqual(
      out.map((c) => c.dead),
      [true, false],
    );
  });
});

describe('heatmap buffer', () => {
  const ctx = {
    pageViewId: 'pv1',
    anonymousId: 'anon',
    sessionId: 'sess',
    url: 'https://shop.test/products/1',
    path: '/products/1',
    startedAt: new Date('2026-09-23T00:00:00Z'),
  };
  const sample = {
    scrollY: 0,
    viewportWidth: 1280,
    viewportHeight: 800,
    documentWidth: 1280,
    documentHeight: 4000,
  };

  it('assigns click indexes in order and sends each click once', () => {
    const buffer = new HeatmapBuffer();
    buffer.start(ctx, sample);
    const base: ClassifiedClick = {
      selector: 'body > a',
      tag: 'a',
      relX: 1,
      relY: 2,
      pageX: 3,
      pageY: 4,
      occurredAt: Date.parse('2026-09-23T00:00:01Z'),
      rage: false,
      dead: false,
      error: false,
    };
    buffer.addClick(base);
    buffer.addClick({ ...base, selector: 'body > b' });
    const first = buffer.drain(new Date());
    assert.equal(first.length, 1);
    assert.deepEqual(
      first[0]!.clicks.map((c) => c.clickIndex),
      [0, 1],
    );
    assert.equal(first[0]!.initialFoldPx, 800);
    assert.equal(buffer.drain(new Date()).length, 0);

    buffer.updateScroll({ ...sample, scrollY: 1200 });
    const second = buffer.drain(new Date());
    assert.equal(second.length, 1);
    assert.equal(second[0]!.clicks.length, 0);
    assert.equal(second[0]!.maxScrollDepthPx, 2000);
  });

  it('caps clicks per pageview', () => {
    const buffer = new HeatmapBuffer();
    buffer.start(ctx, sample);
    const c: ClassifiedClick = {
      selector: 's',
      tag: 'a',
      relX: 0,
      relY: 0,
      pageX: 0,
      pageY: 0,
      occurredAt: 0,
      rage: false,
      dead: false,
      error: false,
    };
    for (let i = 0; i < MAX_CLICKS_PER_PAGEVIEW + 20; i++) buffer.addClick(c);
    assert.equal(buffer.drain(new Date())[0]!.clicks.length, MAX_CLICKS_PER_PAGEVIEW);
  });

  it('still sends a closed pageview after a new one starts', () => {
    const buffer = new HeatmapBuffer();
    buffer.start(ctx, sample);
    buffer.start({ ...ctx, pageViewId: 'pv2' }, sample);
    const drained = buffer.drain(new Date());
    assert.deepEqual(
      drained.map((p) => p.pageViewId),
      ['pv1', 'pv2'],
    );
  });
});
