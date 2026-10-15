import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ServerpodTransport } from '@newtalaria/core';
import { hideMap, mapOwners, uploadSourceMaps } from '@newtalaria/cli';
import { collectCommits, resolveBuildRelease, type ReleaseCommit } from './release.js';

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
  /** false when the server has no releases.setCommits yet (SDK-RELEASE-API.md). */
  commitsSupported: boolean;
  mapsUploaded: boolean;
  mapsUploadedCount?: number;
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
  const projectId = options.projectId ?? env.TALARIA_PROJECT_ID;
  log(`release ${release}${identity.commitSha ? ` (${identity.commitSha.slice(0, 12)}, from ${identity.source})` : ''} -> ${url}`);

  if (identity.commitSha) {
    if (projectId) {
      try {
        await transport.call('source', 'createProjectRelease', {
          projectId,
          input: { __className__: 'CreateProjectReleaseInput', version: release, commitSha: identity.commitSha },
        });
        result.releaseCreated = true;
        log('release created');
      } catch (err) {
        error(`release create failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      error('release create skipped: set TALARIA_PROJECT_ID (the server needs it; see SDK-RELEASE-API.md)');
    }
    const commits = options.commits ?? collectCommits({ commitSha: identity.commitSha, previousCommitSha: options.previousCommitSha ?? env.TALARIA_PREVIOUS_COMMIT_SHA, limit: options.commitLimit, cwd: options.projectDir });
    if (commits.length) {
      try {
        await transport.call('releases', 'setCommits', {
          input: { __className__: 'SetReleaseCommitsInput', version: release, commitSha: identity.commitSha, previousCommitSha: options.previousCommitSha ?? env.TALARIA_PREVIOUS_COMMIT_SHA ?? null, commits },
        });
        result.commitsSent = commits.length;
        log(`${commits.length} commits attached`);
      } catch (err) {
        if (isMissingEndpoint(err)) {
          result.commitsSupported = false;
          error('commits not attached: the server has no releases/setCommits yet (SDK-RELEASE-API.md)');
        } else {
          error(`commits not attached: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
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
