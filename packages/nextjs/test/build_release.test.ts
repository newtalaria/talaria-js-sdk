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
  it('probes setCommits for the previous release, sends previous..HEAD, uploads _next/static paths, verifies via sourceMaps/list, deletes maps', async () => {
    const { dir, chunks } = await fakeBuild();
    const PREV = 'c'.repeat(40);
    const calls: Array<{ path: string; params: Record<string, any> }> = [];
    const transport = { call: async (endpoint: string, method: string, params: Record<string, any>) => {
      calls.push({ path: `${endpoint}/${method}`, params });
      if (method === 'setCommits') return { version: params.input.version, commitSha: params.input.commitSha, commitCount: params.input.commits.length, previousReleaseVersion: 'main@ccccccc', previousReleaseCommitSha: PREV };
      if (method === 'list') return { items: [{ fileName: '_next/static/chunks/main-1a.js', release: 'main@aaaaaaa' }], pagination: { totalPages: 1 } };
      return {};
    } };
    const commits = [
      { id: SHA, authorName: 'a', authorEmail: 'a@x', timestamp: '2026-10-15T00:00:00Z', message: 'head' },
      { id: 'd'.repeat(40), authorName: 'b', authorEmail: 'b@x', timestamp: '2026-10-14T00:00:00Z', message: 'older' },
    ];
    const uploaded: string[] = [];
    const prev = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      uploaded.push(`${String(url)} ${(JSON.parse(String(init?.body)) as { input: { fileName: string } }).input.fileName}`);
      return new Response('{"id":"m1"}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    let r;
    try {
      r = await finalizeTalariaRelease({ projectDir: dir, release: 'main@aaaaaaa', commitSha: SHA, url: 'http://localhost:8180', apiKey: 'tal_live_rw', env: {}, transport, commits, log: () => {}, error: () => {} });
    } finally {
      globalThis.fetch = prev;
    }
    assert.deepEqual(calls.map((c) => c.path), ['releases/setCommits', 'releases/setCommits', 'sourceMaps/list']);
    const [probe, fullCall] = calls;
    assert.equal(probe!.params.input.previousCommitSha, null);
    assert.deepEqual(probe!.params.input.commits.map((c: any) => c.id), [SHA]);
    assert.equal(fullCall!.params.input.previousCommitSha, PREV);
    assert.equal(fullCall!.params.input.commits.length, 2);
    assert.equal(fullCall!.params.input.commits[0].__className__, 'ReleaseCommitInput');
    assert.equal(fullCall!.params.input.__className__, 'SetReleaseCommitsInput');
    assert.deepEqual(calls[2]!.params, { release: 'main@aaaaaaa', page: 1, pageSize: 100 });
    assert.equal(r.releaseCreated, true);
    assert.equal(r.commitsSent, 2);
    assert.equal(r.previousReleaseCommitSha, PREV);
    assert.equal(r.mapsVerified, 1);
    assert.deepEqual(uploaded, ['http://localhost:8180/sourceMaps/upload _next/static/chunks/main-1a.js']);
    assert.deepEqual(await readdir(chunks), ['main-1a.js']);
    assert.deepEqual(await readdir(path.join(dir, '.next', 'static', 'css')), []);
    assert.equal((await readFile(path.join(chunks, 'main-1a.js'), 'utf8')).includes('sourceMappingURL'), false);
  });
  it('uses TALARIA_PREVIOUS_COMMIT_SHA without a probe, and falls back to createProjectRelease (no projectId) on an old server', async () => {
    const { dir } = await fakeBuild();
    const calls: Array<{ path: string; params: Record<string, any> }> = [];
    let hasSetCommits = true;
    const transport = { call: async (endpoint: string, method: string, params: Record<string, any>) => {
      calls.push({ path: `${endpoint}/${method}`, params });
      if (method === 'setCommits' && !hasSetCommits) throw Object.assign(new Error('HTTP 404'), { status: 404 });
      if (method === 'setCommits') return { commitCount: params.input.commits.length, previousReleaseCommitSha: params.input.previousCommitSha };
      return { items: [] };
    } };
    const prev = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{"id":"m"}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      const commits = [{ id: SHA, authorName: 'a', authorEmail: 'a@x', timestamp: 't', message: 'm' }];
      await finalizeTalariaRelease({ projectDir: dir, release: 'r', commitSha: SHA, apiKey: 'k', env: { TALARIA_PREVIOUS_COMMIT_SHA: 'e'.repeat(40) }, transport, commits, deleteSourceMaps: false, log: () => {}, error: () => {} });
      assert.deepEqual(calls.filter((c) => c.path === 'releases/setCommits').length, 1);
      assert.equal(calls[0]!.params.input.previousCommitSha, 'e'.repeat(40));
      calls.length = 0;
      hasSetCommits = false;
      const r = await finalizeTalariaRelease({ projectDir: dir, release: 'r', commitSha: SHA, apiKey: 'k', env: {}, transport, commits, log: () => {}, error: () => {} });
      const create = calls.find((c) => c.path === 'source/createProjectRelease');
      assert.ok(create && !('projectId' in create.params));
      assert.equal(r.commitsSupported, false);
      assert.equal(r.releaseCreated, true);
    } finally {
      globalThis.fetch = prev;
    }
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
