import { initServer } from '@newtalaria/nextjs/server';

const apiKey = process.env.TALARIA_API_KEY ?? '';
if (apiKey) {
  initServer({
    dsn: process.env.TALARIA_DSN ?? 'https://ingest.newtalaria.com',
    apiKey,
    remoteConfig: true,
    serviceName: 'next-example',
  });
}
