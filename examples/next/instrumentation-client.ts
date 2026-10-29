import { initClient } from '@newtalaria/nextjs/client';

const apiKey = process.env.TALARIA_BROWSER_API_KEY ?? '';
if (apiKey) {
  initClient({
    url: process.env.TALARIA_URL ?? 'https://ingest.newtalaria.com',
    apiKey,
    remoteConfig: true,
  });
}
