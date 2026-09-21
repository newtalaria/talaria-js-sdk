import { initEdge } from '@newtalaria/nextjs/edge';

const apiKey = process.env.TALARIA_API_KEY ?? '';
if (apiKey) {
  initEdge({
    dsn: process.env.TALARIA_DSN ?? 'https://api.newtalaria.com',
    apiKey,
    environment: process.env.TALARIA_ENVIRONMENT ?? 'development',
  });
}
