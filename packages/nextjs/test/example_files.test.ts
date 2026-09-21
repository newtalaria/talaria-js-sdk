import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const example = join(process.cwd(), '../../examples/next');

describe('Next example recipes', () => {
  it('wires client, server, action, and route handler', () => {
    const client = readFileSync(join(example, 'instrumentation-client.ts'), 'utf8');
    const server = readFileSync(join(example, 'talaria.server.config.ts'), 'utf8');
    const action = readFileSync(join(example, 'app/actions.ts'), 'utf8');
    const route = readFileSync(join(example, 'app/api/boom/route.ts'), 'utf8');
    assert.match(client, /@newtalaria\/nextjs\/client/);
    assert.match(server, /@newtalaria\/nextjs\/server/);
    assert.match(action, /withServerAction/);
    assert.match(route, /withRouteHandler/);
  });
});
