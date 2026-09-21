export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./talaria.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./talaria.edge.config');
  }
}

export { captureRequestError as onRequestError } from '@newtalaria/nextjs/server';
