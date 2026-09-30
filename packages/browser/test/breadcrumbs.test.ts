import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BreadcrumbBuffer,
  consoleBreadcrumb,
  MAX_OTHER_BREADCRUMBS,
  MAX_QUERY_BREADCRUMBS,
  networkBreadcrumb,
} from '../src/tracing/breadcrumbs.ts';

describe('breadcrumb ring buffer', () => {
  it('caps non-query crumbs at 35 and keeps the latest', () => {
    const buf = new BreadcrumbBuffer();
    for (let i = 0; i < 60; i++) {
      buf.add(consoleBreadcrumb('info', `msg-${i}`));
    }
    assert.equal(buf.size, MAX_OTHER_BREADCRUMBS);
    const all = buf.snapshot();
    assert.equal(all.length, 35);
    assert.equal(all[0]!.message, 'msg-25');
    assert.equal(all[34]!.message, 'msg-59');
    assert.equal(buf.snapshot(3).map((c) => c.message).join(','), 'msg-57,msg-58,msg-59');
  });

  it('query crumbs do not evict application crumbs', () => {
    const buf = new BreadcrumbBuffer();
    buf.add({
      timestamp: new Date().toISOString(),
      type: 'default',
      message: 'shopify.import_products',
    });
    for (let i = 0; i < 50; i++) {
      buf.add({
        timestamp: new Date().toISOString(),
        type: 'query',
        message: `SELECT File ${i}`,
      });
    }
    const messages = buf.snapshot().map((crumb) => crumb.message);
    assert.equal(messages.includes('shopify.import_products'), true);
    assert.equal(messages.length, MAX_QUERY_BREADCRUMBS + 1);
    assert.equal(messages[1], 'SELECT File 35');
  });

  it('maps fetch meta onto http breadcrumbs', () => {
    const crumb = networkBreadcrumb({
      method: 'POST',
      url: 'https://app.example.com/api',
      status: 500,
      durationMs: 12,
      ok: false,
      transport: 'fetch',
      failureKind: 'http',
    });
    assert.equal(crumb.type, 'http');
    assert.equal(crumb.category, 'fetch');
    assert.equal(crumb.level, 'error');
    assert.equal(crumb.data?.method, 'POST');
    assert.equal(crumb.data?.status_code, '500');
  });
});
