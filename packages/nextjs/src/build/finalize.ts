import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ServerpodTransport } from '@newtalaria/core';
import { hideMap, mapOwners, uploadSourceMaps } from '@newtalaria/cli';
import { collectCommits, resolveBuildRelease, type ReleaseCommit } from './release.js';

const MAX_COMMITS = 250;
const FULL_SHA = /^[0-9a-f]{40}$/i;

type Env = Record<string, string | undefined>;
type Transport = Pick<ServerpodTransport, 'call'>;

export interface FinalizeOptions {
  /** App root (where `next build` ran). */
  projectDir: string;
  /** Next `distDir`, relative to projectDir. Default `.next`. */
  distDir?: string;
  release?: string;
  commitSha?: string;
  /** Talaria API URL. Default TALARIA_BASE_URL, then NEXT_PUBLIC_TALARIA_DSN, then http://localhost:8080. */
  url?: string;
  /** `releases:write` key. Default TALARIA_RELEASE_KEY. The browser ingest key is never used. */
  apiKey?: string;
  /** Project id for release creation. Default TALARIA_PROJECT_ID. */
  projectId?: string;
  /** Delete uploaded maps and their sourceMappingURL comments (default true). */
  deleteSourceMaps?: boolean;
  /** Previous release commit, for the commit range. Default TALARIA_PREVIOUS_COMMIT_SHA. */
  previousCommitSha?: string;
  commitLimit?: number;
  env?: Env;
  log?: (line: string) => void;
  error?: (line: string) => void;
  /** Test seam. */
  transport?: Transport;
  /** Test seam: commits instead of running git. */
  commits?: ReleaseCommit[];
}

export interface FinalizeResult {
  skipped?: string;
  release?: string;
  commitSha?: string;
  releaseCreated: boolean;
  commitsSent: number;
  /** false when the server has no releases/setCommits (older server); release then comes from createProjectRelease. */
  commitsSupported: boolean;
  mapsUploaded: boolean;
  mapsUploadedCount?: number;
  /** Uploaded maps the server lists for the release (sourceMaps/list); undefined if listing failed. */
  mapsVerified?: number;
  previousReleaseCommitSha?: string | null;
  mapsHidden: number;
}

const isMissingEndpoint = (err: unknown) => {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message : String(err);
  return status === 404 || /not ?found|no such (endpoint|method)|MethodNotFound|EndpointNotFound/i.test(msg);
};

/**
 * After `next build` (or at deploy): create the release with its commits, upload `.next/static`
 * source maps as `_next/static/...` (the served paths), then delete the public `.map` files.
 * Never throws: a failed upload must not fail the build; problems are logged and returned.
 */
export async function finalizeTalariaRelease(options: FinalizeOptions): Promise<FinalizeResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((l: string) => console.log(`[talaria] ${l}`));
  const error = options.error ?? ((l: string) => console.warn(`[talaria] ${l}`));
  const result: FinalizeResult = { releaseCreated: false, commitsSent: 0, commitsSupported: true, mapsUploaded: false, mapsHidden: 0 };
  const identity = resolveBuildRelease({ release: options.release, commitSha: options.commitSha, env, cwd: options.projectDir });
  result.release = identity.release;
  result.commitSha = identity.commitSha;
  const apiKey = options.apiKey ?? env.TALARIA_RELEASE_KEY;
  const deleteMaps = options.deleteSourceMaps !== false;
  const staticDir = path.join(options.projectDir, options.distDir ?? '.next', 'static');
  if (!identity.release) {
    result.skipped = 'no release: set TALARIA_RELEASE or build from a git checkout';
  } else if (!apiKey) {
    result.skipped = 'TALARIA_RELEASE_KEY is not set (releases:write key)';
  }
  if (result.skipped) {
    error(`source map upload skipped: ${result.skipped}`);
    if (deleteMaps) result.mapsHidden = await hideAllMaps(staticDir);
    return result;
  }
  const release = identity.release!;
  const url = options.url ?? env.TALARIA_BASE_URL ?? env.NEXT_PUBLIC_TALARIA_DSN ?? 'http://localhost:8080';
  const transport = options.transport ?? new ServerpodTransport({ baseUrl: url, apiKey: apiKey! });
  const projectId = options.projectId ?? env.TALARIA_PROJECT_ID; // optional: the key names the project
  log(`release ${release}${identity.commitSha ? ` (${identity.commitSha.slice(0, 12)}, from ${identity.source})` : ''} -> ${url}`);

  if (identity.commitSha) {
    await attachRelease({ transport, release, commitSha: identity.commitSha, projectId, options, env, result, log, error });
  }

  const lines: string[] = [];
  const code = await uploadSourceMaps({
    cwd: options.projectDir,
    argv: ['sourcemaps', 'upload', staticDir, '--url-prefix', '_next/static', '--release', release, '--url', url, '--api-key', apiKey!, ...(deleteMaps ? ['--delete-after-upload'] : [])],
    env,
    log: (l) => lines.push(l),
    error,
  });
  result.mapsUploaded = code === 0;
  const uploaded = lines.filter((l) => l.startsWith('_next/static/') && l.includes(' ')).length;
  result.mapsUploadedCount = uploaded;
  log(`${uploaded} source maps uploaded${code === 0 ? '' : ' (some failed)'}`);
  const expected = lines.filter((l) => l.includes(' ') && !l.startsWith('http')).map((l) => l.split(' ')[0]!);
  result.mapsVerified = await verifyUpload(transport, release, expected, error);
  if (result.mapsVerified !== undefined) log(`server lists ${result.mapsVerified}/${expected.length} uploaded maps for ${release}`);
  // Anything the upload left behind (failed uploads, CSS maps) must not be served either.
  if (deleteMaps) result.mapsHidden = await hideAllMaps(staticDir);
  return result;
}

/** Delete every `.map` under dir (stripping JS sourceMappingURL comments). Returns how many were left to hide. */
export async function hideAllMaps(dir: string): Promise<number> {
  let count = 0;
  const owners = await mapOwners(dir);
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.js.map')) { await hideMap(full, owners.get(full)); count++; }
      else if (e.name.endsWith('.map')) { await rm(full, { force: true }); count++; }
      else if (e.name.endsWith('.css')) await stripCssMapComment(full);
    }
  };
  await walk(dir);
  return count;
}

const CSS_MAP_COMMENT = /\/\*[#@] sourceMappingURL=[^*]*\*\/\s*/g;

async function stripCssMapComment(file: string): Promise<void> {
  const css = await readFile(file, 'utf8');
  const stripped = css.replace(CSS_MAP_COMMENT, '');
  if (stripped !== css) await writeFile(file, stripped);
}

interface SetCommitsResponse {
  version?: string;
  commitSha?: string;
  commitCount?: number;
  previousReleaseVersion?: string | null;
  previousReleaseCommitSha?: string | null;
}

/**
 * releases/setCommits creates the release and replaces its commits. The range is
 * previousReleaseCommitSha..HEAD: the first call (HEAD only) returns the previous release's SHA,
 * then the full range is sent. TALARIA_PREVIOUS_COMMIT_SHA skips the probe. On an older server
 * without setCommits, falls back to source/createProjectRelease (projectId optional with a key).
 */
async function attachRelease(a: {
  transport: Transport; release: string; commitSha: string; projectId?: string; options: FinalizeOptions;
  env: Env; result: FinalizeResult; log: (l: string) => void; error: (l: string) => void;
}): Promise<void> {
  const { transport, release, commitSha, options, env, result, log, error } = a;
  const full = FULL_SHA.test(commitSha) ? commitSha : undefined;
  const all = (prev?: string) =>
    (options.commits ?? collectCommits({ commitSha, previousCommitSha: prev, limit: options.commitLimit ?? MAX_COMMITS, cwd: options.projectDir }))
      .filter((c) => FULL_SHA.test(c.id))
      .slice(0, MAX_COMMITS);
  const send = async (commits: ReleaseCommit[], previous: string | null) =>
    (await transport.call('releases', 'setCommits', {
      input: {
        __className__: 'SetReleaseCommitsInput', version: release, commitSha: full, previousCommitSha: previous,
        commits: commits.map((c) => ({ __className__: 'ReleaseCommitInput', ...c })),
      },
    })) as SetCommitsResponse | undefined;
  if (full) {
    try {
      let previous = options.previousCommitSha ?? env.TALARIA_PREVIOUS_COMMIT_SHA ?? null;
      let response: SetCommitsResponse | undefined;
      if (!previous) {
        const head = all().filter((c) => c.id === full);
        response = await send(head, null);
        previous = response?.previousReleaseCommitSha ?? null;
      }
      const commits = all(previous && previous !== full ? previous : undefined);
      if (!response || commits.length > 1) response = await send(commits, previous);
      result.releaseCreated = true;
      result.commitsSent = response?.commitCount ?? commits.length;
      result.previousReleaseCommitSha = response?.previousReleaseCommitSha ?? previous;
      log(`release created with ${result.commitsSent} commits${previous ? ` since ${previous.slice(0, 7)}` : ''}`);
      return;
    } catch (err) {
      if (!isMissingEndpoint(err)) {
        error(`releases/setCommits failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      result.commitsSupported = false;
      error('server has no releases/setCommits; creating the release without commits');
    }
  }
  try {
    await transport.call('source', 'createProjectRelease', {
      ...(a.projectId ? { projectId: a.projectId } : {}),
      input: { __className__: 'CreateProjectReleaseInput', version: release, commitSha },
    });
    result.releaseCreated = true;
    log('release created');
  } catch (err) {
    error(`release create failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** sourceMaps/list for the release (key-scoped); counts how many uploaded names the server has. */
async function verifyUpload(transport: Transport, release: string, expected: string[], error: (l: string) => void): Promise<number | undefined> {
  if (!expected.length) return 0;
  const seen = new Set<string>();
  try {
    for (let page = 1; page <= 20; page++) {
      const res = (await transport.call('sourceMaps', 'list', { release, page, pageSize: 100 })) as { items?: Array<{ fileName?: string; release?: string }>; pagination?: { totalPages?: number } } | undefined;
      for (const item of res?.items ?? []) if (item.fileName && (item.release ?? release) === release) seen.add(item.fileName);
      if (!res?.items?.length || page >= (res.pagination?.totalPages ?? 1)) break;
    }
  } catch (err) {
    error(`could not verify the upload (sourceMaps/list): ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  return expected.filter((n) => seen.has(n)).length;
}
