import type { Breadcrumb } from '../types.js';

export const MAX_BREADCRUMBS = 50;
export const MAX_QUERY_BREADCRUMBS = 15;
export const MAX_OTHER_BREADCRUMBS = 35;

export type { Breadcrumb };

/** Ring buffer. Query crumbs cannot evict other crumbs. */
export class BreadcrumbBuffer {
  private items: Breadcrumb[] = [];

  add(crumb: Breadcrumb): void {
    const isQuery = crumb.type === 'query';
    const cap = isQuery ? MAX_QUERY_BREADCRUMBS : MAX_OTHER_BREADCRUMBS;
    const sameTier = this.items.filter((item) => (item.type === 'query') === isQuery);
    const overflow = sameTier.length - (cap - 1);
    if (overflow > 0) {
      const drop = new Set(sameTier.slice(0, overflow));
      this.items = this.items.filter((item) => !drop.has(item));
    }
    this.items.push(crumb);
  }

  /** Last `limit` crumbs (default: the whole buffer, capped at 50). */
  snapshot(limit: number = MAX_BREADCRUMBS): Breadcrumb[] {
    if (limit <= 0) return [];
    return this.items.slice(-Math.min(limit, MAX_BREADCRUMBS)).map(cloneBreadcrumb);
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}

export function consoleBreadcrumb(level: string, message: string): Breadcrumb {
  const mapped =
    level === 'error'
      ? 'error'
      : level === 'warn' || level === 'warning'
        ? 'warning'
        : level === 'debug'
          ? 'debug'
          : 'info';
  return {
    timestamp: new Date().toISOString(),
    type: 'default',
    category: 'console',
    message: message.slice(0, 4000),
    level: mapped,
  };
}

export function navigationBreadcrumb(
  url: string,
  category: 'pageload' | 'navigation' = 'pageload',
): Breadcrumb {
  return {
    timestamp: new Date().toISOString(),
    type: 'navigation',
    category,
    message: url,
    level: 'info',
    data: { url },
  };
}

export function normalizeBreadcrumb(
  crumb: Partial<Breadcrumb> & { type?: string; message?: string },
): Breadcrumb {
  return {
    timestamp: crumb.timestamp ?? new Date().toISOString(),
    type: crumb.type ?? 'default',
    category: crumb.category,
    message: crumb.message?.slice(0, 4000),
    level: crumb.level,
    data: crumb.data ? { ...crumb.data } : undefined,
  };
}

function cloneBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  return {
    timestamp: crumb.timestamp,
    type: crumb.type,
    category: crumb.category,
    message: crumb.message,
    level: crumb.level,
    data: crumb.data ? { ...crumb.data } : undefined,
  };
}
