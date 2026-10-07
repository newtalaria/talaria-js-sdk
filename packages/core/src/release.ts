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
  return proc?.env ?? {};
}

function fromCi(env: ReleaseEnv): ReleaseIdentity {
  const githubRef = nonEmpty(env.GITHUB_REF_NAME);
  const githubSha = nonEmpty(env.GITHUB_SHA);
  if (githubRef && githubSha && githubSha.length >= 7) {
    const type = nonEmpty(env.GITHUB_REF_TYPE);
    return {
      release: `${githubRef}@${githubSha.slice(0, 7)}`,
      commitSha: githubSha,
      releaseRefKind: type === 'tag' || type === 'branch' ? type : undefined,
    };
  }

  const gitlabRef = nonEmpty(env.CI_COMMIT_REF_NAME);
  const gitlabSha = nonEmpty(env.CI_COMMIT_SHA);
  if (gitlabRef && gitlabSha && gitlabSha.length >= 7) {
    return {
      release: `${gitlabRef}@${gitlabSha.slice(0, 7)}`,
      commitSha: gitlabSha,
      releaseRefKind: nonEmpty(env.CI_COMMIT_TAG) ? 'tag' : 'branch',
    };
  }

  return {};
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
