import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_SELECTOR_LENGTH,
  buildSelector,
  isStableClass,
  isStableId,
  type SelectorElement,
} from '../src/heatmaps/selector.ts';

interface FakeSpec {
  tag: string;
  id?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  children?: FakeSpec[];
}

class FakeEl implements SelectorElement {
  tagName: string;
  id?: string;
  classList: string[];
  parentElement: FakeEl | null = null;
  previousElementSibling: FakeEl | null = null;
  nextElementSibling: FakeEl | null = null;
  children: FakeEl[] = [];
  private attrs: Record<string, string>;

  constructor(spec: FakeSpec) {
    this.tagName = spec.tag.toUpperCase();
    this.id = spec.id;
    this.classList = spec.classes ?? [];
    this.attrs = spec.attrs ?? {};
    let prev: FakeEl | null = null;
    for (const childSpec of spec.children ?? []) {
      const child = new FakeEl(childSpec);
      child.parentElement = this;
      child.previousElementSibling = prev;
      if (prev) prev.nextElementSibling = child;
      prev = child;
      this.children.push(child);
    }
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
}

function tree(spec: FakeSpec): FakeEl {
  const html = new FakeEl({ tag: 'html', children: [{ tag: 'body', children: [spec] }] });
  return html.children[0]!.children[0]!;
}

describe('heatmap selector', () => {
  it('anchors on data-talaria-heatmap first', () => {
    const root = tree({
      tag: 'div',
      id: 'hero',
      children: [{ tag: 'button', attrs: { 'data-talaria-heatmap': 'cta-primary' } }],
    });
    assert.equal(
      buildSelector(root.children[0]!),
      '[data-talaria-heatmap="cta-primary"]',
    );
  });

  it('anchors on a stable ancestor id and uses nth-of-type for siblings', () => {
    const root = tree({
      tag: 'nav',
      id: 'main-nav',
      children: [
        { tag: 'a', classes: ['nav-link'] },
        { tag: 'a', classes: ['nav-link', 'active'] },
      ],
    });
    assert.equal(
      buildSelector(root.children[1]!),
      '#main-nav > a.nav-link:nth-of-type(2)',
    );
  });

  it('walks to body when there is no anchor', () => {
    const root = tree({
      tag: 'main',
      children: [{ tag: 'section', children: [{ tag: 'button', classes: ['buy'] }] }],
    });
    assert.equal(
      buildSelector(root.children[0]!.children[0]!),
      'body > main > section > button.buy',
    );
  });

  it('drops generated, state, and private classes and ids', () => {
    assert.equal(isStableClass('css-1x2y3z'), false);
    assert.equal(isStableClass('sc-bdVaJa'), false);
    assert.equal(isStableClass('Button_primary__a1B2c'), false);
    assert.equal(isStableClass('active'), false);
    assert.equal(isStableClass('user-12345'), false);
    assert.equal(isStableClass('hover:bg-red'), false);
    assert.equal(isStableClass('btn-primary'), true);
    assert.equal(isStableId(':r1:'), false);
    assert.equal(isStableId('radix-abc'), false);
    assert.equal(isStableId('order-998877'), false);
    assert.equal(isStableId('checkout'), true);

    const root = tree({
      tag: 'div',
      id: 'jane@example.com',
      children: [{ tag: 'span', classes: ['css-abc123', 'label'] }],
    });
    const selector = buildSelector(root.children[0]!);
    assert.equal(selector.includes('@'), false);
    assert.equal(selector, 'body > div > span.label');
  });

  it('names the root element instead of returning an empty selector', () => {
    const html = new FakeEl({ tag: 'html', children: [{ tag: 'body' }] });
    assert.equal(buildSelector(html), 'html');
    assert.equal(buildSelector(html.children[0]!), 'body');
  });

  it('caps selector length', () => {
    let spec: FakeSpec = { tag: 'span' };
    for (let i = 0; i < 11; i++) {
      spec = {
        tag: 'div',
        classes: ['a-very-long-stable-class-name-here', 'another-long-class-name'],
        children: [spec],
      };
    }
    let el = tree(spec);
    while (el.children.length > 0) el = el.children[0]!;
    const selector = buildSelector(el);
    assert.ok(selector.length <= MAX_SELECTOR_LENGTH);
    assert.ok(selector.endsWith('span'));
  });
});
