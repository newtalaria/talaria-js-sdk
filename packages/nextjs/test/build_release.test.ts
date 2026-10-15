import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { collectCommits, resolveBuildRelease } from '../src/build/release.ts';
import { finalizeTalariaRelease } from '../src/build/finalize.ts';
import { withTalariaConfig } from '../src/config/index.ts';

const SHA = 'a'.repeat(40);
const noGit = () => undefined;

describe('resolveBuildRelease', () => {
  it('prefers explicit options, then TALARIA_RELEASE, then host env, then git', () => {
    assert.deepEqual(resolveBuildRelease({ release: 'v1', commitSha: SHA, env: {}, git: noGit }), { release: 'v1', commitSha: SHA, branch: undefined, source: 'options' });
    assert.equal(resolveBuildRelease({ env: { TALARIA_RELEASE: 'r9', VERCEL_GIT_COMMIT_SHA: SHA }, git: noGit }).release, 'r9');
    const vercel = resolveBuildRelease({ env: { VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: 'main' }, git: noGit });
    assert.deepEqual(vercel, { release: 'main@aaaaaaa', commitSha: SHA, branch: 'main', source: 'env' });
    assert.equal(resolveBuildRelease({ env: { CF_PAGES_COMMIT_SHA: SHA, CF_PAGES_BRANCH: 'prod' }, git: noGit }).release, 'prod@aaaaaaa');
    const git = (args: string[]) => (args[1] === 'HEAD' ? 'b'.repeat(40) : 'feature/x');
    assert.deepEqual(resolveBuildRelease({ env: {}, git }), { release: 'feature/x@bbbbbbb', commitSha: 'b'.repeat(40), branch: 'feature/x', source: 'git' });
  });
  it('ignores a non-SHA commit and returns none without git', () => {
    assert.equal(resolveBuildRelease({ env: { GITHUB_SHA: 'not-a-sha' }, git: noGit }).commitSha, undefined);
    assert.equal(resolveBuildRelease({ env: {}, git: noGit }).source, 'none');
  });
});

describe('collectCommits', () => {
  it('parses git log rows and uses the previous..current range', () => {
    let seen: string[] = [];
    const git = (args: string[]) => { seen = args; return `${SHA}\x1fAna\x1fana@x\x1f2026-10-15T00:00:00+13:00\x1fFix checkout\x1e\n`; };
    const commits = collectCommits({ commitSha: SHA, previousCommitSha: 'c'.repeat(40), git });
    assert.equal(seen.at(-1), `${'c'.repeat(40)}..${SHA}`);
    assert.deepEqual(commits, [{ id: SHA, authorName: 'Ana', authorEmail: 'ana@x', timestamp: '2026-10-15T00:00:00+13:00', message: 'Fix checkout' }]);
  });
});

async function fakeBuild() {
  const dir = await mkdtemp(path.join(tmpdir(), 'talaria-next-app-'));
  const chunks = path.join(dir, '.next', 'static', 'chunks');
  await mkdir(chunks, { recursive: true });
  await writeFile(path.join(chunks, 'main-1a.js'), 'x()\n//# sourceMappingURL=main-1a.js.map\n');
  await writeFile(path.join(chunks, 'main-1a.js.map'), JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA' }));
  await mkdir(path.join(dir, '.next', 'static', 'css'), { recursive: true });
  await writeFile(path.join(dir, '.next', 'static', 'css', 'a.css.map'), '{}');
  return { dir, chunks };
}

describe('finalizeTalariaRelease', () => {
  it('creates the release, reports missing setCommits, uploads _next/static paths and deletes maps', async () => {
    const { dir, chunks } = await fakeBuild();
    const calls: string[] = [];
    const transport = { call: async (endpoint: string, method: string) => {
      calls.push(`${endpoint}/${method}`);
      if (method === 'setCommits') throw Object.assign(new Error('Talaria releases/setCommits failed: HTTP 404'), { status: 404 });
      return {};
    } };
    const uploaded: string[] = [];
    const prev = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      uploaded.push(`${String(url)} ${(JSON.parse(String(init?.body)) as { input: { fileName: string; release: string } }).input.fileName}`);
      return new Response('{"id":"m1"}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const r = await finalizeTalariaRelease({
        projectDir: dir, release: 'main@aaaaaaa', commitSha: SHA, url: 'http://localhost:8180', apiKey: 'tal_live_rw', projectId: 'p1',
        env: {}, transport, commits: [{ id: SHA, authorName: 'a', authorEmail: 'a@x', timestamp: 't', message: 'm' }], log: () => {}, error: () => {},
      });
      assert.equal(r.releaseCreated, true);
      assert.equal(r.commitsSupported, false);
      assert.equal(r.mapsUploaded, true);
      assert.equal(r.mapsUploadedCount, 1);
    } finally {
      globalThis.fetch = prev;
    }
    assert.deepEqual(calls, ['source/createProjectRelease', 'releases/setCommits']);
    assert.deepEqual(uploaded, ['http://localhost:8180/sourceMaps/upload _next/static/chunks/main-1a.js']);
    assert.deepEqual(await readdir(chunks), ['main-1a.js']);
    assert.deepEqual(await readdir(path.join(dir, '.next', 'static', 'css')), []);
    assert.equal((await readFile(path.join(chunks, 'main-1a.js'), 'utf8')).includes('sourceMappingURL'), false);
  });
  it('skips without a releases:write key but still hides maps', async () => {
    const { dir, chunks } = await fakeBuild();
    const r = await finalizeTalariaRelease({ projectDir: dir, release: 'r', env: {}, log: () => {}, error: () => {} });
    assert.match(r.skipped ?? '', /TALARIA_RELEASE_KEY/);
    assert.deepEqual(await readdir(chunks), ['main-1a.js']);
  });
});

describe('withTalariaConfig release + upload wiring', () => {
  it('inlines the release env, enables maps for upload and chains runAfterProductionCompile', async () => {
    const order: string[] = [];
    const cfg = withTalariaConfig(
      { env: { KEEP: '1' }, compiler: { runAfterProductionCompile: () => { order.push('app'); } } },
      { release: 'v2', commitSha: SHA, uploadSourceMaps: false, silent: true },
    );
    assert.deepEqual(cfg.env, { NEXT_PUBLIC_TALARIA_RELEASE: 'v2', NEXT_PUBLIC_TALARIA_COMMIT_SHA: SHA, KEEP: '1' });
    assert.equal(cfg.productionBrowserSourceMaps, false);
    await cfg.compiler!.runAfterProductionCompile!({ distDir: '/x/.next', projectDir: '/x' });
    assert.deepEqual(order, ['app']);
    const up = withTalariaConfig({}, { release: 'v2', commitSha: SHA, uploadSourceMaps: true, silent: true });
    assert.equal(up.productionBrowserSourceMaps, true);
  });
});
