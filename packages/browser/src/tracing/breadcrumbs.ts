import type { NetworkMeta } from '../replay/hooks.js';
import type { Breadcrumb } from '@newtalaria/core';

export {
  BreadcrumbBuffer,
  consoleBreadcrumb,
  MAX_BREADCRUMBS,
  navigationBreadcrumb,
  normalizeBreadcrumb,
} from '@newtalaria/core';

export type { Breadcrumb };

export function networkBreadcrumb(meta: NetworkMeta): Breadcrumb {
  const data: Record<string, string> = {
    method: meta.method || 'GET',
    url: meta.url || '',
  };
  if (typeof meta.status === 'number' && meta.status > 0) {
    data.status_code = String(meta.status);
  }
  if (typeof meta.durationMs === 'number') {
    data.durationMs = String(meta.durationMs);
  }
  if (meta.transport) data.transport = meta.transport;
  if (meta.failureKind) data.failure_kind = meta.failureKind;
  if (meta.party) data.party = meta.party;

  const failed = meta.ok === false;
  return {
    timestamp: new Date().toISOString(),
    type: 'http',
    category: meta.transport === 'xhr' ? 'xhr' : 'fetch',
    message: `${meta.method || 'GET'} ${meta.url || ''}`.trim(),
    level: failed ? 'error' : 'info',
    data,
  };
}
