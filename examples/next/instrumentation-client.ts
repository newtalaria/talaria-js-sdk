import { initClient } from '@newtalaria/nextjs/client';

const apiKey = process.env.NEXT_PUBLIC_TALARIA_API_KEY ?? '';
if (apiKey) {
  initClient({
    url: process.env.NEXT_PUBLIC_TALARIA_URL ?? 'https://ingest.newtalaria.com',
    apiKey,
    remoteConfig: true,
  });
}
