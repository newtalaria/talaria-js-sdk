import { initClient } from '@newtalaria/nextjs/client';

const apiKey = process.env.NEXT_PUBLIC_TALARIA_API_KEY ?? '';
if (apiKey) {
  initClient({
    dsn: process.env.NEXT_PUBLIC_TALARIA_DSN ?? 'https://ingest.newtalaria.com',
    apiKey,
    environment: process.env.NEXT_PUBLIC_TALARIA_ENVIRONMENT ?? 'development',
    remoteConfig: true,
  });
}
