#!/usr/bin/env node
/**
 * Integration test: build the Northline demo (dunatron/new_talaria demos/northline_web) with
 * withTalariaConfig and check the release tag and the source-map upload.
 *
 *   NORTHLINE_APP=/path/to/demos/northline_web node test/integration/northline.mjs
 *
 * Talaria: TALARIA_BASE_URL + TALARIA_RELEASE_KEY (+ TALARIA_PROJECT_ID) for a real stack; without
 * them a local stub implementing SDK-RELEASE-API.md records the calls. Builds a copy in a temp git
 * repo (so release/commits come from git), with this monorepo's packages packed and installed.
 * One `next build`, no reseed, nothing written to the app checkout.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '../../../..');
const app = process.env.NORTHLINE_APP;
if (!app || !existsSync(path.join(app, 'package.json'))) { console.error('Set NORTHLINE_APP to demos/northline_web'); process.exit(2); }
const sh = (cmd, args, cwd, extra = {}) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...extra });
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

// 1. Stub Talaria unless a real one is given.
const calls = [];
const stored = [];
let STUB_PREVIOUS = null; // set to the first commit of the temp repo below
let server;
let baseUrl = process.env.TALARIA_BASE_URL;
// Real stack: NORTHLINE_SEED_CMD (e.g. `dart run bin/seed_demo.dart --key-only --json`) prints
// releaseKey + projectId (new_talaria #38); no reseed happens with --key-only.
let seed = {};
if (process.env.NORTHLINE_SEED_CMD) seed = JSON.parse(execFileSync('bash', ['-c', process.env.NORTHLINE_SEED_CMD], { encoding: 'utf8' }));
const apiKey = process.env.TALARIA_RELEASE_KEY ?? seed.releaseKey ?? 'tal_sk_test_nz1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2zE3yZ';
const projectId = process.env.TALARIA_PROJECT_ID ?? seed.projectId; // optional since #38
if (!baseUrl) {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      const json = body ? JSON.parse(body) : {};
      calls.push({ path: req.url, key: req.headers.authorization, body: json });
      let reply = { id: 'r1' };
      if (req.url === '/v1/source-maps') { stored.push(json); reply = { id: `m${calls.length}`, release: json.release, fileName: json.fileName, sizeBytes: 1 }; }
      if (req.url === '/v1/releases') reply = { version: json.version, commitSha: json.commitSha, commitCount: json.commits.length, previousReleaseCommitSha: json.previousCommitSha ?? STUB_PREVIOUS };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

// 2. Copy the app into a temp git repo and wire the plugin in.
const work = mkdtempSync(path.join(tmpdir(), 'northline-plugin-'));
const dest = path.join(work, 'northline_web');
cpSync(app, dest, { recursive: true, filter: (src) => !/\/(node_modules|\.next|test-results|playwright-report)(\/|$)|\.env\.local$/.test(src) });
const cfgName = readdirSync(dest).find((f) => /^next\.config\.(ts|mjs|js)$/.test(f));
const ext = path.extname(cfgName);
cpSync(path.join(dest, cfgName), path.join(dest, `next.config.base${ext}`));
writeFileSync(path.join(dest, cfgName), `import { withTalariaConfig } from "@newtalaria/nextjs/config";\nimport base from "./next.config.base";\nexport default withTalariaConfig(base, { upload: { url: ${JSON.stringify(baseUrl)}${projectId ? `, projectId: ${JSON.stringify(projectId)}` : ''} } });\n`);
// Let the plugin tag events: drop the app's pinned release/commit so the SDK reads the inlined env.
const talariaTs = path.join(dest, 'src/lib/talaria.ts');
if (existsSync(talariaTs)) writeFileSync(talariaTs, readFileSync(talariaTs, 'utf8').replace(/^\s*release: RELEASE,\n/m, '').replace(/^\s*commitSha: process\.env\.NEXT_PUBLIC_COMMIT_SHA[^\n]*\n/m, ''));
sh('git', ['init', '-q', '-b', 'integration'], work);
sh('git', ['-c', 'user.name=Talaria CI', '-c', 'user.email=ci@talaria.test', 'add', '-A'], work);
sh('git', ['-c', 'user.name=Talaria CI', '-c', 'user.email=ci@talaria.test', 'commit', '-qm', 'Northline build for the plugin integration test'], work);
STUB_PREVIOUS = sh('git', ['rev-parse', 'HEAD'], work).trim();
writeFileSync(path.join(dest, 'RELEASE_NOTE.md'), 'Plugin integration build.\n');
sh('git', ['-c', 'user.name=Talaria CI', '-c', 'user.email=ci@talaria.test', 'add', '-A'], work);
sh('git', ['-c', 'user.name=Talaria CI', '-c', 'user.email=ci@talaria.test', 'commit', '-qm', 'Second commit in the release'], work);
writeFileSync(path.join(dest, 'RELEASE_NOTE.md'), 'Plugin integration build, take two.\n');
sh('git', ['-c', 'user.name=Talaria CI', '-c', 'user.email=ci@talaria.test', 'commit', '-qam', 'Third commit in the release'], work);
const head = sh('git', ['rev-parse', 'HEAD'], work).trim();

// 3. Install the app, then this monorepo's packages (packed, so it matches a real install).
const packs = path.join(work, 'packs');
const tgz = [];
for (const pkg of ['core', 'cli', 'browser', 'node', 'react', 'nextjs']) {
  const out = sh('npm', ['pack', '--silent', '--pack-destination', work], path.join(repo, 'packages', pkg)).trim().split('\n').pop();
  tgz.push(path.join(work, out));
}
void packs;
sh('nice', ['npm', 'install', '--no-audit', '--no-fund', '--loglevel=error'], dest, { stdio: 'inherit' });
sh('nice', ['npm', 'install', '--no-save', '--no-audit', '--no-fund', '--loglevel=error', ...tgz], dest, { stdio: 'inherit' });

// 4. Build with the plugin (one heavy process).
const env = { ...process.env, TALARIA_RELEASE_KEY: apiKey, NODE_OPTIONS: '--max-old-space-size=1536', NEXT_TELEMETRY_DISABLED: '1' };
for (const k of ['TALARIA_RELEASE', 'NEXT_PUBLIC_TALARIA_RELEASE', 'VERCEL_GIT_COMMIT_SHA', 'GITHUB_SHA', 'CI_COMMIT_SHA']) delete env[k];
// Async spawn: the stub server lives in this process and must keep answering during the build.
const build = await new Promise((resolve) => {
  const child = spawn('nice', ['npx', 'next', 'build'], { cwd: dest, env });
  let text = '';
  child.stdout.on('data', (d) => (text += d));
  child.stderr.on('data', (d) => (text += d));
  const timer = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000);
  child.on('close', (status) => { clearTimeout(timer); resolve({ status, text }); });
});
const out = build.text;
writeFileSync(path.join(work, 'build.log'), out);
check(build.status === 0, `next build exit ${build.status} (log ${path.join(work, 'build.log')})`);
const release = `integration@${head.slice(0, 7)}`;
check(out.includes(`release ${release}`), `plugin resolved release ${release} from git`);

// 5. Release tag inlined into the client bundle; no public maps or map comments.
const staticDir = path.join(dest, '.next/static');
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
if (existsSync(staticDir)) walk(staticDir);
const js = files.filter((f) => f.endsWith('.js'));
check(js.some((f) => readFileSync(f, 'utf8').includes(release)), 'client bundle carries NEXT_PUBLIC_TALARIA_RELEASE');
check(js.some((f) => readFileSync(f, 'utf8').includes(head)), 'client bundle carries NEXT_PUBLIC_TALARIA_COMMIT_SHA');
check(files.filter((f) => f.endsWith('.map')).length === 0, 'no .map files left in .next/static');
const MAP_COMMENT = /^\/\/[#@] sourceMappingURL=|\/\*[#@] sourceMappingURL=/m;
const withComment = files.filter((f) => /\.(js|css)$/.test(f) && MAP_COMMENT.test(readFileSync(f, 'utf8').slice(-300)));
check(withComment.length === 0, `no sourceMappingURL comments left${withComment.length ? ` (${withComment.map((f) => path.basename(f)).join(', ')})` : ''}`);

// 6. Upload calls (stub) or the build log (real stack).
if (server) {
  const uploads = calls.filter((c) => c.path === '/v1/source-maps');
  const sets = calls.filter((c) => c.path === '/v1/releases');
  const last = sets.at(-1)?.body;
  check(sets.length === 1 && last?.version === release && last.commitSha === head && last.commits.some((c) => c.id === head) && last.commits[0].__className__ === undefined, 'POST /v1/releases sends the release and its commits');
  check(!calls.some((c) => c.path === '/source/createProjectRelease' || c.path === '/sourceMaps/list' || c.path === '/sourceMaps/upload'), 'legacy release RPCs are not called');
  const served = uploads.filter((u) => u.body.fileName.startsWith('_next/static/'));
  check(served.length > 0 && uploads.every((u) => u.body.release === release), `${uploads.length} maps uploaded for ${release}: ${served.length} as _next/static/..., ${uploads.length - served.length} unreferenced by basename`);
  check(calls.every((c) => c.key === `Bearer ${apiKey}`), 'every call used the releases:write key');
  const sample = uploads[0] && JSON.parse(gunzipSync(Buffer.from(uploads[0].body.gzipBytes, 'base64')).toString('utf8'));
  check(Array.isArray(sample?.sources) && sample.sources.length > 0, 'uploaded payload is a real source map');
  const unserved = uploads.map((u) => u.body.fileName).filter((n) => n.includes('/') && !js.some((f) => f.endsWith(n.replace(/^_next\/static/, ''))));
  check(unserved.length === 0, `every upload names a served chunk${unserved.length ? ` (not served: ${unserved.slice(0, 3).join(', ')})` : ''}`);
  server.close();
} else {
  check(/source maps uploaded/.test(out) && !/some failed/.test(out), 'maps uploaded to the real stack');
  check(/release created with \d+ commits/.test(out), 'release created by POST /v1/releases');
}

if (!process.env.KEEP_WORK) rmSync(work, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
