import { initClient } from '@newtalaria/nextjs/client';

initClient({
  dsn: process.env.NEXT_PUBLIC_TALARIA_DSN ?? 'https://api.newtalaria.com',
  apiKey: process.env.NEXT_PUBLIC_TALARIA_API_KEY ?? '',
  environment: process.env.NEXT_PUBLIC_TALARIA_ENVIRONMENT ?? 'development',
  enableTracing: true,
  replaysOnErrorSampleRate: 1,
});
