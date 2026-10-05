import type { TalariaNodeClient } from '../client.js';

export interface RedisLike {
  sendCommand?: (...args: unknown[]) => Promise<unknown>;
}

/**
 * Wrap a Redis client that implements `sendCommand` (`ioredis` or `node-redis`).
 * The command name is the first element when the argument is an array, or
 * `name` when the argument is an ioredis `Command`.
 */
export function wrapRedis<T extends RedisLike>(client: TalariaNodeClient, target: T): T {
  if (typeof target.sendCommand !== 'function') return target;
  const original = target.sendCommand.bind(target);
  target.sendCommand = ((...args: unknown[]) => {
    const command = redisCommandName(args[0]);
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

function redisCommandName(arg: unknown): string {
  if (Array.isArray(arg)) return String(arg[0] ?? 'command');
  if (arg && typeof arg === 'object' && 'name' in arg) {
    const name = (arg as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return 'command';
}
