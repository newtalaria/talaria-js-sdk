import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { finalizeTalariaRelease } from '../src/build/finalize.ts';
import releasesBody from './fixtures/releases.json';

const RELEASE_KEY = 'tal_sk_test_nz1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2zE3yZ';

function assertWire(actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

describe('release wire JSON', () => {
  it('posts /v1/releases with a trimmed 7-40 hex commitSha', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'talaria-wire-release-'));
    await mkdir(path.join(dir, '.next', 'static'), { recursive: true });
    await writeFile(path.join(dir, '.next', 'static', 'keep.js'), 'x()');

    let body: unknown = null;
    const transport = {
      call: async (_endpoint: string, _method: string, params: Record<string, unknown>) => {
        body = params;
        return { commitCount: (params.commits as unknown[]).length, previousReleaseCommitSha: params.previousCommitSha };
      },
    };
    const previous = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{"id":"m"}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      const result = await finalizeTalariaRelease({
        projectDir: dir,
        release: 'main@abcdef1',
        commitSha: '  abcdef1  ',
        url: 'http://ingest.test',
        apiKey: RELEASE_KEY,
        previousCommitSha: releasesBody.previousCommitSha,
        transport,
        commits: releasesBody.commits,
        log: () => {},
        error: () => {},
      });
      assert.equal(result.releaseCreated, true);
      assert.equal(result.commitSha, 'abcdef1');
    } finally {
      globalThis.fetch = previous;
    }

    assertWire(body, releasesBody);
    assert.notEqual((body as { commitSha?: unknown }).commitSha, null);
  });
});
