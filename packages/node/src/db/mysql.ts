import type { TalariaNodeClient } from '../client.js';
import { wrapQueryable, type Queryable } from './sql.js';

/** Wrap a `mysql2` pool or connection. Each `query` becomes a CLIENT span. */
export function wrapMysql2<T extends Queryable>(client: TalariaNodeClient, target: T): T {
  return wrapQueryable(client, target, 'mysql');
}
