import { initServer } from '@newtalaria/nextjs/server';

initServer({
  dsn: process.env.TALARIA_DSN ?? 'https://api.newtalaria.com',
  apiKey: process.env.TALARIA_API_KEY ?? '',
  environment: process.env.TALARIA_ENVIRONMENT ?? 'development',
  enableTracing: true,
  serviceName: 'next-example',
});
