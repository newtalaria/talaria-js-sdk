'use server';

import { withServerAction } from '@newtalaria/nextjs/server';

export const boomAction = withServerAction('boomAction', async () => {
  throw new Error('server action boom');
});
