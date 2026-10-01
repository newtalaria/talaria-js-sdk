import { initEdge } from '@newtalaria/nextjs/edge';

const apiKey = process.env.TALARIA_API_KEY ?? '';
if (apiKey) {
  initEdge({
    dsn: process.env.TALARIA_DSN ?? 'https://ingest.newtalaria.com',
    apiKey,
  });
}
