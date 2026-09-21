import { useState } from 'react';
import { ErrorBoundary, Profiler, Talaria } from '@newtalaria/react';

const dsn = import.meta.env.VITE_TALARIA_DSN || 'https://api.newtalaria.com';
const apiKey = import.meta.env.VITE_TALARIA_API_KEY || '';
const environment = import.meta.env.VITE_TALARIA_ENVIRONMENT || 'development';

export function App() {
  const ready = Boolean(apiKey);

  return (
    <main>
      <h1>Talaria React example</h1>
      <p>
        <code>@newtalaria/react</code> ErrorBoundary, Profiler, and the browser
        capture API.
      </p>
      <p className={`status${ready ? '' : ' warn'}`}>
        {ready ? (
          <>
            Sending to <code>{dsn}</code> as <code>{environment}</code>.
          </>
        ) : (
          <>
            Copy <code>.env.example</code> to <code>.env</code> and set{' '}
            <code>VITE_TALARIA_API_KEY</code>.
          </>
        )}
      </p>
      <ErrorBoundary
        fallback={(error, reset) => (
          <div className="fallback">
            <p>ErrorBoundary caught: {error.message}</p>
            <button type="button" className="secondary" onClick={reset}>
              Reset
            </button>
          </div>
        )}
      >
        <Profiler id="Demo">
          <DemoActions ready={ready} />
        </Profiler>
      </ErrorBoundary>
    </main>
  );
}

function DemoActions({ ready }: { ready: boolean }) {
  const [boom, setBoom] = useState(false);
  if (boom) throw new Error('react render boom');

  return (
    <div className="actions">
      <button
        type="button"
        disabled={!ready}
        onClick={() => void Talaria.captureException(new Error('react captured exception'))}
      >
        Capture exception
      </button>
      <button
        type="button"
        className="secondary"
        disabled={!ready}
        onClick={() => void Talaria.captureMessage('react hello', 'info')}
      >
        Capture message
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => setBoom(true)}
      >
        Throw in render
      </button>
    </div>
  );
}
