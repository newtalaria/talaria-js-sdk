import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(process.cwd(), '../..');

describe('example apps install published packages', () => {
  it('vanilla depends on @newtalaria/browser from npm', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'examples/vanilla/package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      overrides?: Record<string, string>;
    };
    assert.equal(pkg.dependencies['@newtalaria/browser'], '^0.2.0');
    assert.equal(pkg.overrides, undefined);
    const main = readFileSync(join(root, 'examples/vanilla/src/main.ts'), 'utf8');
    assert.match(main, /Talaria\.init/);
    assert.match(readFileSync(join(root, 'examples/vanilla/README.md'), 'utf8'), /git clone/);
  });

  it('react depends on @newtalaria/react from npm', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'examples/react/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies['@newtalaria/react'], '^0.2.0');
    const app = readFileSync(join(root, 'examples/react/src/App.tsx'), 'utf8');
    assert.match(app, /ErrorBoundary/);
    assert.match(readFileSync(join(root, 'examples/react/README.md'), 'utf8'), /git clone/);
  });

  it('next is a standalone app with client, server, action, and route handler', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'examples/next/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies['@newtalaria/nextjs'], '^0.2.0');
    const client = readFileSync(
      join(root, 'examples/next/instrumentation-client.ts'),
      'utf8',
    );
    const server = readFileSync(
      join(root, 'examples/next/talaria.server.config.ts'),
      'utf8',
    );
    const action = readFileSync(join(root, 'examples/next/app/actions.ts'), 'utf8');
    const route = readFileSync(
      join(root, 'examples/next/app/api/boom/route.ts'),
      'utf8',
    );
    assert.match(client, /@newtalaria\/nextjs\/client/);
    assert.match(server, /@newtalaria\/nextjs\/server/);
    assert.match(action, /withServerAction/);
    assert.match(route, /withRouteHandler/);
    assert.match(readFileSync(join(root, 'examples/next/README.md'), 'utf8'), /git clone/);
  });
});
