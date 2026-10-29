#!/usr/bin/env node
import { finalizeTalariaRelease } from './build/finalize.js';

const USAGE = `Usage: talaria-nextjs upload [--dir .] [--dist-dir .next] [--release R] [--commit SHA]
       [--url URL] [--api-key KEY] [--project-id ID] [--previous-commit SHA] [--keep-maps]

Creates the release with its commits, uploads .next/static source maps as _next/static/...,
then deletes the public .map files (unless --keep-maps). Env: TALARIA_RELEASE_KEY, TALARIA_URL,
TALARIA_PROJECT_ID, TALARIA_RELEASE, VERCEL_GIT_COMMIT_SHA / GITHUB_SHA / ... or git.`;

export async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  if (args[0] !== 'upload') {
    console.error(USAGE);
    return args[0] === '--help' || args[0] === '-h' ? 0 : 1;
  }
  args.shift();
  const opts: Record<string, string> = {};
  let keepMaps = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--keep-maps') { keepMaps = true; continue; }
    const key = a.replace(/^--/, '');
    const value = args[i + 1];
    if (!a.startsWith('--') || !value || value.startsWith('--')) { console.error(`Bad flag ${a}\n${USAGE}`); return 1; }
    opts[key] = value;
    i++;
  }
  const result = await finalizeTalariaRelease({
    projectDir: opts.dir ? new URL(opts.dir, `file://${process.cwd()}/`).pathname : process.cwd(),
    distDir: opts['dist-dir'],
    release: opts.release,
    commitSha: opts.commit,
    url: opts.url,
    apiKey: opts['api-key'],
    projectId: opts['project-id'],
    previousCommitSha: opts['previous-commit'],
    deleteSourceMaps: !keepMaps,
  });
  console.log(JSON.stringify(result));
  return result.skipped || !result.mapsUploaded ? 1 : 0;
}

const isMain = process.argv[1] && /talaria-nextjs|cli\.js$/.test(process.argv[1]);
if (isMain) process.exit(await main(process.argv.slice(2)));
