'use client';

import type { CSSProperties } from 'react';
import { boomAction } from './actions';

const dsn =
  process.env.NEXT_PUBLIC_TALARIA_DSN ?? 'https://api.newtalaria.com';
const apiKey = process.env.NEXT_PUBLIC_TALARIA_API_KEY ?? '';
const environment =
  process.env.NEXT_PUBLIC_TALARIA_ENVIRONMENT ?? 'development';
const ready = Boolean(apiKey);

export default function Page() {
  return (
    <main style={{ maxWidth: '40rem', margin: '0 auto', padding: '3rem 1.25rem' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 600 }}>Talaria Next example</h1>
      <p style={{ color: '#9aa3ad' }}>
        Client, Server Action, and Route Handler paths for{' '}
        <code>@newtalaria/nextjs</code>.
      </p>
      <p
        style={{
          padding: '0.75rem 1rem',
          borderRadius: '0.5rem',
          background: '#161a20',
          border: ready ? '1px solid #2a313b' : '1px solid #8a6d1f',
          color: ready ? '#9aa3ad' : '#f0d27a',
        }}
      >
        {ready ? (
          <>
            Sending to <code>{dsn}</code> as <code>{environment}</code>.
          </>
        ) : (
          <>
            Copy <code>.env.example</code> to <code>.env.local</code> and set{' '}
            <code>NEXT_PUBLIC_TALARIA_API_KEY</code> / <code>TALARIA_API_KEY</code>.
          </>
        )}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '1.5rem' }}>
        <button
          type="button"
          disabled={!ready}
          style={buttonStyle}
          onClick={() => {
            throw new Error('client boom');
          }}
        >
          Throw in the browser
        </button>
        <form action={boomAction}>
          <button type="submit" disabled={!ready} style={{ ...buttonStyle, background: '#222831' }}>
            Throw in a Server Action
          </button>
        </form>
        <a
          href="/api/boom"
          style={{
            ...buttonStyle,
            background: '#222831',
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Throw in a Route Handler
        </a>
      </div>
    </main>
  );
}

const buttonStyle: CSSProperties = {
  appearance: 'none',
  border: 0,
  borderRadius: '0.45rem',
  background: '#3d6bff',
  color: 'white',
  padding: '0.55rem 0.9rem',
  font: 'inherit',
  cursor: 'pointer',
};
