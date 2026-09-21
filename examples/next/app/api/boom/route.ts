import { withRouteHandler } from '@newtalaria/nextjs/server';

export const GET = withRouteHandler('GET /api/boom', async () => {
  throw new Error('route handler boom');
});
