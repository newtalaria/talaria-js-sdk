import { Talaria } from '@newtalaria/browser';
import './style.css';

const dsn = import.meta.env.VITE_TALARIA_DSN || 'https://api.newtalaria.com';
const apiKey = import.meta.env.VITE_TALARIA_API_KEY || '';
const environment = import.meta.env.VITE_TALARIA_ENVIRONMENT || 'development';
const ready = Boolean(apiKey);

if (ready) {
  Talaria.init({
    dsn,
    apiKey,
    environment,
    enableTracing: true,
    replaysOnErrorSampleRate: 1,
  });
  Talaria.setUser({ id: 'demo-user' });
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app missing');

app.innerHTML = `
  <main>
    <h1>Talaria vanilla example</h1>
    <p>Bundled <code>@newtalaria/browser</code> via Vite. Also see the
      <a href="/script-tag.html">script-tag page</a>.</p>
    <p class="status ${ready ? '' : 'warn'}">
      ${
        ready
          ? `Sending to <code>${dsn}</code> as <code>${environment}</code>.`
          : 'Copy <code>.env.example</code> to <code>.env</code> and set <code>VITE_TALARIA_API_KEY</code>.'
      }
    </p>
    <div class="actions">
      <button type="button" id="exception" ${ready ? '' : 'disabled'}>Capture exception</button>
      <button type="button" id="message" class="secondary" ${ready ? '' : 'disabled'}>Capture message</button>
      <button type="button" id="throw" class="secondary" ${ready ? '' : 'disabled'}>Throw (window.onerror)</button>
    </div>
  </main>
`;

document.querySelector('#exception')?.addEventListener('click', () => {
  void Talaria.captureException(new Error('vanilla captured exception'));
});
document.querySelector('#message')?.addEventListener('click', () => {
  void Talaria.captureMessage('vanilla hello', 'info');
});
document.querySelector('#throw')?.addEventListener('click', () => {
  throw new Error('vanilla uncaught throw');
});
