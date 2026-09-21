import type { Breadcrumb } from '../types.js';

export const MAX_BREADCRUMBS = 50;

export type { Breadcrumb };

/** Ring buffer of the last {@link MAX_BREADCRUMBS} client breadcrumbs. */
export class BreadcrumbBuffer {
  private items: Breadcrumb[] = [];

  add(crumb: Breadcrumb): void {
    this.items.push(crumb);
    if (this.items.length > MAX_BREADCRUMBS) {
      this.items.splice(0, this.items.length - MAX_BREADCRUMBS);
    }
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
