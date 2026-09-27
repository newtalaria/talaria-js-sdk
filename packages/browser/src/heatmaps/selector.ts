/**
 * Stable CSS selectors for heatmap clicks. The dashboard resolves the same
 * selector inside a rebuilt page snapshot, so the path must survive viewport
 * changes, hover/open state, and CSS-in-JS class churn.
 *
 * Never reads element text or input values.
 */

export interface SelectorElement {
  readonly tagName: string;
  readonly id?: string;
  readonly classList?: ArrayLike<string>;
  readonly parentElement: SelectorElement | null;
  readonly previousElementSibling: SelectorElement | null;
  readonly nextElementSibling: SelectorElement | null;
  getAttribute(name: string): string | null;
}

export const HEATMAP_SELECTOR_ATTR = 'data-talaria-heatmap';
export const MAX_SELECTOR_LENGTH = 512;
const MAX_DEPTH = 12;
const MAX_CLASSES_PER_SEGMENT = 2;

const EMAIL = /[^\s@]+@[^\s@]+/;
const LONG_DIGITS = /\d{4,}/;
const SAFE_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Generated / state classes that differ between the click and the snapshot. */
const UNSTABLE_CLASS: RegExp[] = [
  /^css-[a-z0-9]+/i, // emotion
  /^sc-[A-Za-z0-9]+/, // styled-components
  /^jsx-\d+/, // styled-jsx
  /__[A-Za-z0-9_-]{5,}$/, // CSS modules `Button_primary__a1B2c`
  /^_[A-Za-z0-9]{5,}$/,
  /^[a-z]{1,3}-(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,}$/, // hashed utility prefixes
  /^(?:is|has)-/,
  /^(?:active|hover|focus|focused|open|opened|selected|visible|hidden|show|shown|disabled|expanded|collapsed|current|loading)$/,
];

const UNSTABLE_ID: RegExp[] = [
  /^(?:radix|headlessui|mui|react|rc|ember|ext|yui|ng|vue)[-_:]/i,
  /:/,
  /\d{3,}/,
  /^[0-9a-f]{8,}$/i,
];

function isPrivate(value: string): boolean {
  return EMAIL.test(value) || LONG_DIGITS.test(value);
}

export function isStableClass(name: string): boolean {
  if (!name || name.length > 48) return false;
  if (!SAFE_TOKEN.test(name) || isPrivate(name)) return false;
  return !UNSTABLE_CLASS.some((re) => re.test(name));
}

export function isStableId(id: string): boolean {
  if (!id || id.length > 64) return false;
  if (!SAFE_TOKEN.test(id) || isPrivate(id)) return false;
  return !UNSTABLE_ID.some((re) => re.test(id));
}

function attrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function anchorSegment(el: SelectorElement): string | null {
  const heatmap = el.getAttribute(HEATMAP_SELECTOR_ATTR)?.trim();
  if (heatmap && heatmap.length <= 128) {
    return `[${HEATMAP_SELECTOR_ATTR}="${attrValue(heatmap)}"]`;
  }
  const testId = el.getAttribute('data-testid')?.trim();
  if (testId && testId.length <= 128 && !isPrivate(testId)) {
    return `[data-testid="${attrValue(testId)}"]`;
  }
  const id = el.id?.trim();
  if (id && isStableId(id)) return `#${id}`;
  return null;
}

function nthOfType(el: SelectorElement): number | null {
  const tag = el.tagName;
  let index = 1;
  let hasSameTag = false;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.tagName === tag) {
      index += 1;
      hasSameTag = true;
    }
  }
  if (!hasSameTag) {
    for (let s = el.nextElementSibling; s; s = s.nextElementSibling) {
      if (s.tagName === tag) {
        hasSameTag = true;
        break;
      }
    }
  }
  return hasSameTag ? index : null;
}

function stableClasses(el: SelectorElement): string[] {
  const list = el.classList;
  if (!list) return [];
  const out: string[] = [];
  for (let i = 0; i < list.length && out.length < MAX_CLASSES_PER_SEGMENT; i++) {
    const name = list[i];
    if (name && isStableClass(name)) out.push(name);
  }
  return out;
}

interface Segment {
  tag: string;
  classes: string[];
  nth: number | null;
}

function renderSegment(seg: Segment, withClasses: boolean): string {
  let out = seg.tag;
  if (withClasses) for (const c of seg.classes) out += `.${c}`;
  if (seg.nth != null) out += `:nth-of-type(${seg.nth})`;
  return out;
}

/**
 * Build a selector for [el]. Walks up until a stable anchor
 * (`data-talaria-heatmap`, `data-testid`, stable `id`) or `body`.
 */
export function buildSelector(el: SelectorElement): string {
  const segments: Segment[] = [];
  let anchor: string | null = null;
  let node: SelectorElement | null = el;
  let depth = 0;

  while (node && depth < MAX_DEPTH) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'html') break;
    if (tag === 'body') {
      anchor = 'body';
      break;
    }
    const a = anchorSegment(node);
    if (a) {
      anchor = a;
      break;
    }
    segments.unshift({ tag, classes: stableClasses(node), nth: nthOfType(node) });
    node = node.parentElement;
    depth += 1;
  }

  if (!anchor && segments.length === 0) return el.tagName.toLowerCase();

  const join = (withClasses: boolean, from = 0): string => {
    const parts = segments.slice(from).map((s) => renderSegment(s, withClasses));
    if (anchor && from === 0) parts.unshift(anchor);
    return parts.join(' > ');
  };

  let selector = join(true);
  if (selector.length <= MAX_SELECTOR_LENGTH) return selector;
  selector = join(false);
  let from = 0;
  while (selector.length > MAX_SELECTOR_LENGTH && from < segments.length - 1) {
    from += 1;
    selector = join(false, from);
  }
  return selector.slice(0, MAX_SELECTOR_LENGTH);
}
