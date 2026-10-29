import { initServer } from '@newtalaria/nextjs/server';

const apiKey = process.env.TALARIA_API_KEY ?? '';
if (apiKey) {
  initServer({
    url: process.env.TALARIA_URL ?? 'https://ingest.newtalaria.com',
    apiKey,
    remoteConfig: true,
    serviceName: 'next-example',
  });
}
