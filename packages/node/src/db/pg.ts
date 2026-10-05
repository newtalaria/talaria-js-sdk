import type { TalariaNodeClient } from '../client.js';
import { wrapQueryable, type Queryable } from './sql.js';

/** Wrap a `pg` `Pool` or `Client`. Each `query` becomes a CLIENT span. */
export function wrapPg<T extends Queryable>(client: TalariaNodeClient, target: T): T {
  return wrapQueryable(client, target, 'postgresql');
}
