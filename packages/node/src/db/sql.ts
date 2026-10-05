import type { Span } from '@newtalaria/core';
import type { TalariaNodeClient } from '../client.js';

export interface Queryable {
  query: (...args: unknown[]) => Promise<unknown> | unknown;
}

/**
 * Wrap any client with a `query` method so each call becomes a DB span.
 * `pg` and `mysql2` use this. Pass the OpenTelemetry system name (`postgresql`, `mysql`).
 * The driver stays a peer dependency you already installed.
 */
export function wrapQueryable<T extends Queryable>(
  client: TalariaNodeClient,
  target: T,
  system: string,
): T {
  const original = target.query.bind(target);
  target.query = ((...args: unknown[]) => {
    const sql = typeof args[0] === 'string' ? args[0] : '';
    const text = queryText(sql);
    client.addBreadcrumb({
      type: 'query',
      category: 'db',
      message: operationName(sql),
      level: 'info',
      data: { 'db.system.name': system },
    });
    const span: Span | null = client.recordsQuerySpans
      ? client.startSpan(spanName(sql, system), {
          kind: 'client',
          attributes: {
            'db.system.name': system,
            'db.operation.name': operationName(sql),
            ...(text ? { 'db.query.text': text } : {}),
          },
        })
      : null;
    try {
      const result = original(...args);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then(
          (value) => {
            span?.setStatus('ok');
            span?.end();
            return value;
          },
          (error) => {
            span?.setStatus('error', error instanceof Error ? error.message : String(error));
            span?.end();
            throw error;
          },
        );
      }
      span?.setStatus('ok');
      span?.end();
      return result;
    } catch (error) {
      span?.setStatus('error', error instanceof Error ? error.message : String(error));
      span?.end();
      throw error;
    }
  }) as T['query'];
  return target;
}

export function operationName(sql: string): string {
  const match = /^\s*([A-Za-z]+)/.exec(sql);
  const verb = match?.[1] ? match[1].toUpperCase() : 'QUERY';
  if (verb === 'FROM') return 'SELECT';
  return verb;
}

export function spanName(sql: string, system: string): string {
  const operation = operationName(sql);
  const table = /\b(?:FROM|INTO|UPDATE|TABLE)\s+(?:`|"|\[)?([A-Za-z_][A-Za-z0-9_.]*)/i.exec(sql);
  const name = table?.[1];
  if (name && name.toUpperCase() !== 'SELECT') return `${operation} ${name}`;
  return sql ? operation : `db ${system}`;
}

/** Strip string literals and numbers so a span can group on statement shape. */
export function queryText(sql: string): string {
  if (!sql) return '';
  const stripped = sql
    .replace(/'(?:\\'|[^'])*'/g, '?')
    .replace(/\b\d+\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 1024 ? `${stripped.slice(0, 1021)}...` : stripped;
}
