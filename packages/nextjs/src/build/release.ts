import { execFileSync } from 'node:child_process';

export interface BuildRelease {
  release?: string;
  commitSha?: string;
  branch?: string;
  /** Where the values came from, for the build log. */
  source: 'options' | 'env' | 'git' | 'none';
}

type Env = Record<string, string | undefined>;
type Git = (args: string[]) => string | undefined;

/** Commit SHA variables set by hosts and CI, in priority order. */
export const COMMIT_ENV = [
  'TALARIA_COMMIT_SHA',
  'NEXT_PUBLIC_TALARIA_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'GITHUB_SHA',
  'CI_COMMIT_SHA',
  'CF_PAGES_COMMIT_SHA',
  'RENDER_GIT_COMMIT',
  'COMMIT_REF',
  'SOURCE_VERSION',
  'BITBUCKET_COMMIT',
  'CIRCLE_SHA1',
] as const;

/** Branch variables matching COMMIT_ENV. */
export const BRANCH_ENV = [
  'VERCEL_GIT_COMMIT_REF',
  'GITHUB_REF_NAME',
  'CI_COMMIT_REF_NAME',
  'CF_PAGES_BRANCH',
  'RENDER_GIT_BRANCH',
  'BRANCH',
  'BITBUCKET_BRANCH',
  'CIRCLE_BRANCH',
] as const;

const SHA = /^[0-9a-f]{7,40}$/i;

export function gitRunner(cwd: string): Git {
  return (args) => {
    try {
      return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim() || undefined;
    } catch {
      return undefined;
    }
  };
}

function first(env: Env, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Release and commit for a build: explicit options, then TALARIA_RELEASE / host and CI variables
 * (Vercel, GitHub Actions, GitLab, Cloudflare Pages, Render, Netlify, Heroku, Bitbucket, CircleCI),
 * then the local git checkout. The default release is `<branch>@<sha7>`, the same shape the SDK
 * derives on GitHub Actions and GitLab.
 */
export function resolveBuildRelease(input: { release?: string; commitSha?: string; env?: Env; cwd?: string; git?: Git } = {}): BuildRelease {
  const env = input.env ?? process.env;
  const git = input.git ?? gitRunner(input.cwd ?? process.cwd());
  const explicitRelease = input.release?.trim() || env.TALARIA_RELEASE?.trim() || env.NEXT_PUBLIC_TALARIA_RELEASE?.trim();
  let commitSha = input.commitSha?.trim() || first(env, COMMIT_ENV);
  let branch = first(env, BRANCH_ENV);
  let source: BuildRelease['source'] = input.release || input.commitSha ? 'options' : commitSha || explicitRelease ? 'env' : 'none';
  if (!commitSha) {
    const head = git(['rev-parse', 'HEAD']);
    if (head && SHA.test(head)) {
      commitSha = head;
      if (source === 'none') source = 'git';
    }
  }
  if (commitSha && !SHA.test(commitSha)) commitSha = undefined;
  if (!branch && source !== 'none') {
    const ref = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (ref && ref !== 'HEAD') branch = ref;
  }
  const generated = commitSha
    ? (branch ? `${branch.replaceAll('/', '-')}@${commitSha.slice(0, 7)}` : commitSha.slice(0, 12))
    : undefined;
  const release = (explicitRelease ? explicitRelease.replaceAll('/', '-') : generated);
  return { release, commitSha, branch, source: release || commitSha ? source : 'none' };
}

export interface ReleaseCommit {
  id: string;
  authorName: string;
  authorEmail: string;
  timestamp: string;
  message: string;
}

/** Commits in the release: `previous..commitSha` when the previous release commit is known, else the last `limit`. */
export function collectCommits(input: { commitSha: string; previousCommitSha?: string; limit?: number; git?: Git; cwd?: string }): ReleaseCommit[] {
  const git = input.git ?? gitRunner(input.cwd ?? process.cwd());
  const limit = Math.max(1, Math.min(input.limit ?? 20, 250));
  const range = input.previousCommitSha && SHA.test(input.previousCommitSha) ? `${input.previousCommitSha}..${input.commitSha}` : input.commitSha;
  const format = '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e';
  let out = git(['log', `--max-count=${limit}`, format, range]);
  // The previous release's commit may not be in this checkout (shallow CI clone, rewritten
  // history): fall back to the last `limit` commits instead of sending none.
  if (out === undefined && range !== input.commitSha) out = git(['log', `--max-count=${limit}`, format, input.commitSha]);
  if (!out) return [];
  return out
    .split('\x1e')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [id = '', authorName = '', authorEmail = '', timestamp = '', message = ''] = row.split('\x1f');
      return { id, authorName, authorEmail, timestamp, message };
    })
    .filter((c) => SHA.test(c.id));
}
