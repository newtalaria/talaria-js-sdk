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
    assert.deepEqual(resolveBuildRelease({ env: {}, git }), { release: 'feature-x@bbbbbbb', commitSha: 'b'.repeat(40), branch: 'feature/x', source: 'git' });
  });
  it('ignores a non-SHA commit and returns none without git', () => {
    assert.equal(resolveBuildRelease({ env: { GITHUB_SHA: 'not-a-sha' }, git: noGit }).commitSha, undefined);
    assert.equal(resolveBuildRelease({ env: {}, git: noGit }).source, 'none');
  });
});

describe('collectCommits', () => {
  it('falls back to the last commits when the previous release commit is unknown here', () => {
    const seen: string[][] = [];
    const git = (args: string[]) => { seen.push(args); return args.at(-1)!.includes('..') ? undefined : `${SHA}\x1fA\x1fa@x\x1ft\x1fm\x1e`; };
    const commits = collectCommits({ commitSha: SHA, previousCommitSha: 'f'.repeat(40), git });
    assert.equal(seen.length, 2);
    assert.equal(seen[1]!.at(-1), SHA);
    assert.equal(commits.length, 1);
  });
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

const RELEASE_KEY = 'tal_sk_test_nz1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2zE3yZ';

describe('finalizeTalariaRelease', () => {
  it('POSTs /v1/releases once and uploads maps to /v1/source-maps', async () => {
    const { dir, chunks } = await fakeBuild();
    const PREV = 'c'.repeat(40);
    const calls: Array<{ path: string; params: Record<string, any> }> = [];
    const transport = { call: async (endpoint: string, method: string, params: Record<string, any>) => {
      calls.push({ path: `${endpoint}/${method}`, params });
      return {
        version: params.version,
        commitSha: params.commitSha,
        commitCount: params.commits.length,
        previousReleaseCommitSha: params.previousCommitSha,
      };
    } };
    const commits = [
      { id: SHA, authorName: 'a', authorEmail: 'a@x', timestamp: '2026-10-15T00:00:00Z', message: 'head' },
      { id: 'd'.repeat(40), authorName: 'b', authorEmail: 'b@x', timestamp: '2026-10-14T00:00:00Z', message: 'older' },
    ];
    const uploaded: string[] = [];
    const prev = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      uploaded.push(`${String(url)} ${(JSON.parse(String(init?.body)) as { fileName: string }).fileName}`);
      return new Response('{"id":"m1"}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    let r;
    try {
      r = await finalizeTalariaRelease({
        projectDir: dir,
        release: 'main@aaaaaaa',
        commitSha: SHA,
        url: 'http://localhost:8180',
        apiKey: RELEASE_KEY,
        env: { TALARIA_PREVIOUS_COMMIT_SHA: PREV },
        transport,
        commits,
        log: () => {},
        error: () => {},
      });
    } finally {
      globalThis.fetch = prev;
    }
    assert.deepEqual(calls.map((c) => c.path), ['v1/releases']);
    assert.equal(calls[0]!.params.version, 'main@aaaaaaa');
    assert.equal(calls[0]!.params.previousCommitSha, PREV);
    assert.equal(calls[0]!.params.commits.length, 2);
    assert.equal(calls[0]!.params.commits[0].id, SHA);
    assert.equal(calls[0]!.params.__className__, undefined);
    assert.equal(r.releaseCreated, true);
    assert.equal(r.commitsSent, 2);
    assert.equal(r.previousReleaseCommitSha, PREV);
    assert.equal(r.mapsVerified, undefined);
    assert.deepEqual(uploaded, ['http://localhost:8180/v1/source-maps _next/static/chunks/main-1a.js']);
    assert.deepEqual(await readdir(chunks), ['main-1a.js']);
    assert.deepEqual(await readdir(path.join(dir, '.next', 'static', 'css')), []);
    assert.equal((await readFile(path.join(chunks, 'main-1a.js'), 'utf8')).includes('sourceMappingURL'), false);
  });
  it('does not fall back to createProjectRelease when POST /v1/releases fails', async () => {
    const { dir } = await fakeBuild();
    const calls: Array<{ path: string; params: Record<string, any> }> = [];
    const transport = { call: async (endpoint: string, method: string, params: Record<string, any>) => {
      calls.push({ path: `${endpoint}/${method}`, params });
      throw Object.assign(new Error('HTTP 404'), { status: 404 });
    } };
    const prev = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{"id":"m"}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      const commits = [{ id: SHA, authorName: 'a', authorEmail: 'a@x', timestamp: 't', message: 'm' }];
      const errors: string[] = [];
      const r = await finalizeTalariaRelease({
        projectDir: dir,
        release: 'r',
        commitSha: SHA,
        apiKey: RELEASE_KEY,
        url: 'http://localhost:8180',
        env: { TALARIA_PREVIOUS_COMMIT_SHA: 'e'.repeat(40) },
        transport,
        commits,
        log: () => {},
        error: (line) => errors.push(line),
      });
      assert.deepEqual(calls.map((c) => c.path), ['v1/releases']);
      assert.equal(calls[0]!.params.previousCommitSha, 'e'.repeat(40));
      assert.equal(calls.some((c) => String(c.path).includes('createProjectRelease')), false);
      assert.equal(r.commitsSupported, true);
      assert.equal(r.releaseCreated, false);
      assert.ok(errors.some((line) => line.includes('/v1/releases')));
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
