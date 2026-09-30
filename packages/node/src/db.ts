import type { Span } from '@newtalaria/core';
import type { TalariaNodeClient } from './client.js';

export interface Queryable {
  query: (...args: unknown[]) => Promise<unknown> | unknown;
}

/**
 * Wrap a `pg` / `mysql2` pool or connection so queries become DB spans.
 * Optional — the driver is a peer dependency you already installed.
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

export function wrapPg<T extends Queryable>(client: TalariaNodeClient, target: T): T {
  return wrapQueryable(client, target, 'postgresql');
}

export function wrapMysql2<T extends Queryable>(client: TalariaNodeClient, target: T): T {
  return wrapQueryable(client, target, 'mysql');
}

export interface RedisLike {
  sendCommand?: (...args: unknown[]) => Promise<unknown>;
}

export function wrapRedis<T extends RedisLike>(client: TalariaNodeClient, target: T): T {
  if (typeof target.sendCommand !== 'function') return target;
  const original = target.sendCommand.bind(target);
  target.sendCommand = ((...args: unknown[]) => {
    const command = Array.isArray(args[0]) ? String((args[0] as unknown[])[0] ?? 'command') : 'command';
    const span = client.startSpan(`db redis ${command}`, {
      kind: 'client',
      attributes: { 'db.system': 'redis', 'db.operation': command },
    });
    return original(...args).then(
      (value) => {
        span?.setStatus('ok');
        span?.end();
        return value;
      },
      (error: unknown) => {
        span?.setStatus('error', error instanceof Error ? error.message : String(error));
        span?.end();
        throw error;
      },
    );
  }) as T['sendCommand'];
  return target;
}

function operationName(sql: string): string {
  const match = /^\s*([A-Za-z]+)/.exec(sql);
  return match?.[1] ? match[1].toUpperCase() : 'QUERY';
}

function spanName(sql: string, system: string): string {
  const operation = operationName(sql);
  const table = /\b(?:FROM|INTO|UPDATE|TABLE)\s+(?:`|"|\[)?([A-Za-z_][A-Za-z0-9_.]*)/i.exec(sql);
  const name = table?.[1];
  if (name && name.toUpperCase() !== 'SELECT') return `${operation} ${name}`;
  return sql ? operation : `db ${system}`;
}

function queryText(sql: string): string {
  if (!sql) return '';
  const stripped = sql
    .replace(/'(?:\\'|[^'])*'/g, '?')
    .replace(/\b\d+\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 1024 ? `${stripped.slice(0, 1021)}...` : stripped;
}
