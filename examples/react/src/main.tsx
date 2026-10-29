import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Talaria, reactErrorHandler } from '@newtalaria/react';
import { App } from './App';
import './style.css';

const apiKey = import.meta.env.VITE_TALARIA_BROWSER_API_KEY || '';

if (apiKey) {
  Talaria.init({
    url: import.meta.env.VITE_TALARIA_URL || 'https://ingest.newtalaria.com',
    apiKey,
    remoteConfig: true,
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
