/**
 * Drop into `instrumentation.ts`:
 *
 * ```ts
 * export { register, onRequestError } from '@newtalaria/nextjs/server';
 * ```
 *
 * Then create `talaria.server.config.ts` / `talaria.edge.config.ts` that call init.
 */
export async function register(): Promise<void> {
  const runtime = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.NEXT_RUNTIME;
  if (runtime === 'edge') {
    await import('./edge/index.js');
    return;
  }
  await import('./server/index.js');
}
