export type ReleaseRefKind = 'branch' | 'tag';

export interface ReleaseIdentity {
  release?: string;
  commitSha?: string;
  releaseRefKind?: ReleaseRefKind;
}

export interface ReleaseEnv {
  TALARIA_RELEASE?: string;
  TALARIA_COMMIT_SHA?: string;
  NEXT_PUBLIC_TALARIA_RELEASE?: string;
  NEXT_PUBLIC_TALARIA_COMMIT_SHA?: string;
  GITHUB_REF_NAME?: string;
  GITHUB_SHA?: string;
  GITHUB_REF_TYPE?: string;
  CI_COMMIT_REF_NAME?: string;
  CI_COMMIT_SHA?: string;
  CI_COMMIT_TAG?: string;
}

/**
 * `<ref>@<7-char sha>` from an explicit value, then CI environment variables.
 * Does not run git. CI fills the release only when both release and commit SHA
 * are empty.
 */
export function resolveReleaseIdentity(input: {
  release?: string;
  commitSha?: string;
  env?: ReleaseEnv;
}): ReleaseIdentity {
  const env = input.env ?? {};
  const explicitRelease = nonEmpty(input.release) ?? nonEmpty(env.TALARIA_RELEASE) ?? nonEmpty(env.NEXT_PUBLIC_TALARIA_RELEASE);
  const explicitSha =
    nonEmpty(input.commitSha) ??
    nonEmpty(env.TALARIA_COMMIT_SHA) ??
    nonEmpty(env.NEXT_PUBLIC_TALARIA_COMMIT_SHA);
  const ci = fromCi(env);

  if (explicitRelease || explicitSha) {
    return {
      release: explicitRelease,
      commitSha: explicitSha,
      releaseRefKind:
        explicitRelease && ci.release && explicitRelease === ci.release
          ? ci.releaseRefKind
          : undefined,
    };
  }

  return ci;
}

/** Reads inlined `process.env` when a bundler left it on `globalThis`. */
export function readProcessReleaseEnv(): ReleaseEnv {
  const proc = (globalThis as { process?: { env?: ReleaseEnv } }).process;
  return { ...inlinedReleaseEnv(), ...(proc?.env ?? {}) };
}

declare const process: { env: Record<string, string | undefined> } | undefined;

/**
 * Literal `process.env.NEXT_PUBLIC_*` reads, so bundlers that inline public env vars (Next.js,
 * and `withTalariaConfig`, which sets these at build time) tag browser events with the release
 * and commit even where `globalThis.process` does not exist.
 */
function inlinedReleaseEnv(): ReleaseEnv {
  const out: ReleaseEnv = {};
  try {
    const release = process!.env.NEXT_PUBLIC_TALARIA_RELEASE;
    if (release) out.NEXT_PUBLIC_TALARIA_RELEASE = release;
  } catch {
    // not inlined and no process
  }
  try {
    const sha = process!.env.NEXT_PUBLIC_TALARIA_COMMIT_SHA;
    if (sha) out.NEXT_PUBLIC_TALARIA_COMMIT_SHA = sha;
  } catch {
    // not inlined and no process
  }
  return out;
}

function fromCi(env: ReleaseEnv): ReleaseIdentity {
  const githubRef = nonEmpty(env.GITHUB_REF_NAME);
  const githubSha = nonEmpty(env.GITHUB_SHA);
  if (githubRef && githubSha && githubSha.length >= 7) {
    const type = nonEmpty(env.GITHUB_REF_TYPE);
    return {
      release: releaseName(githubRef, githubSha),
      commitSha: githubSha,
      releaseRefKind: type === 'tag' || type === 'branch' ? type : undefined,
    };
  }

  const gitlabRef = nonEmpty(env.CI_COMMIT_REF_NAME);
  const gitlabSha = nonEmpty(env.CI_COMMIT_SHA);
  if (gitlabRef && gitlabSha && gitlabSha.length >= 7) {
    return {
      release: releaseName(gitlabRef, gitlabSha),
      commitSha: gitlabSha,
      releaseRefKind: nonEmpty(env.CI_COMMIT_TAG) ? 'tag' : 'branch',
    };
  }

  return {};
}

/** M11: `/` in a ref becomes `-` so the release matches `^[A-Za-z0-9][A-Za-z0-9._+@-]{0,199}$`. */
function releaseName(ref: string, sha: string): string {
  return `${ref.replaceAll('/', '-')}@${sha.slice(0, 7)}`;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
