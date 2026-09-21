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
    const span: Span | null = client.startSpan(`db ${system}`, {
      kind: 'client',
      attributes: {
        'db.system': system,
        ...(sql ? { 'db.statement': sql.slice(0, 256) } : {}),
      },
    });
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
