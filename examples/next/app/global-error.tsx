'use client';

import { useEffect } from 'react';
import { Talaria } from '@newtalaria/nextjs/client';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    void Talaria.captureException(error, {
      extra: { digest: error.digest ?? '' },
    });
  }, [error]);

  return (
    <html>
      <body>
        <h1>Something went wrong</h1>
      </body>
    </html>
  );
}
