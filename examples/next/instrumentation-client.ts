import { initClient } from '@newtalaria/nextjs/client';

const apiKey = process.env.NEXT_PUBLIC_TALARIA_API_KEY ?? '';
if (apiKey) {
  initClient({
    dsn: process.env.NEXT_PUBLIC_TALARIA_DSN ?? 'https://api.newtalaria.com',
    apiKey,
    environment: process.env.NEXT_PUBLIC_TALARIA_ENVIRONMENT ?? 'development',
    enableTracing: true,
    replaysOnErrorSampleRate: 1,
  });
}
