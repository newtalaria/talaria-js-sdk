import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Talaria, reactErrorHandler } from '@newtalaria/react';
import { App } from './App';
import './style.css';

const apiKey = import.meta.env.VITE_TALARIA_API_KEY || '';

if (apiKey) {
  Talaria.init({
    dsn: import.meta.env.VITE_TALARIA_DSN || 'https://api.newtalaria.com',
    apiKey,
    environment: import.meta.env.VITE_TALARIA_ENVIRONMENT || 'development',
    enableTracing: true,
    replaysOnErrorSampleRate: 1,
  });
  Talaria.setUser({ id: 'demo-user' });
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing');

createRoot(rootEl, {
  onUncaughtError: reactErrorHandler(),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
