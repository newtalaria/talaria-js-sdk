'use client';

import { boomAction } from './actions';

export default function Page() {
  return (
    <main>
      <h1>Talaria Next example</h1>
      <button
        type="button"
        onClick={() => {
          throw new Error('client boom');
        }}
      >
        Throw in the browser
      </button>
      <form action={boomAction}>
        <button type="submit">Throw in a Server Action</button>
      </form>
      <a href="/api/boom">Throw in a Route Handler</a>
    </main>
  );
}
