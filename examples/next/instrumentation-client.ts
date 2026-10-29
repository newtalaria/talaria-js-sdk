import { initClient } from '@newtalaria/nextjs/client';

// Use NEXT_PUBLIC_ prefix per Next.js framework rules
const apiKey = process.env.NEXT_PUBLIC_TALARIA_BROWSER_API_KEY ?? '';
if (apiKey) {
  initClient({
    url: process.env.NEXT_PUBLIC_TALARIA_URL ?? 'https://ingest.newtalaria.com',
    apiKey,
    remoteConfig: true,
  });
}
