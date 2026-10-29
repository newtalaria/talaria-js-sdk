import { initEdge } from '@newtalaria/nextjs/edge';

const apiKey = process.env.TALARIA_API_KEY ?? '';
if (apiKey) {
  initEdge({
    url: process.env.TALARIA_URL ?? 'https://ingest.newtalaria.com',
    apiKey,
  });
}
