import { initServer } from '@newtalaria/nextjs/server';

const apiKey = process.env.TALARIA_API_KEY ?? '';
if (apiKey) {
  initServer({
    dsn: process.env.TALARIA_DSN ?? 'https://api.newtalaria.com',
    apiKey,
    environment: process.env.TALARIA_ENVIRONMENT ?? 'development',
    enableTracing: true,
    serviceName: 'next-example',
  });
}
