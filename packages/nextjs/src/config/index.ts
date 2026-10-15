import { finalizeTalariaRelease, type FinalizeOptions } from '../build/finalize.js';
import { resolveBuildRelease } from '../build/release.js';

export { finalizeTalariaRelease, hideAllMaps } from '../build/finalize.js';
export type { FinalizeOptions, FinalizeResult } from '../build/finalize.js';
export { resolveBuildRelease, collectCommits } from '../build/release.js';
export type { BuildRelease, ReleaseCommit } from '../build/release.js';

export interface TalariaNextConfig {
  /**
   * Keep browser source maps out of the deployed `.next/static` (default true). With an upload,
   * maps are generated, uploaded, then deleted; without one they are not generated at all.
   */
  hideSourceMaps?: boolean;
  /** Release name. Default TALARIA_RELEASE, else `<branch>@<sha7>` from host/CI env or git. */
  release?: string;
  /** Commit SHA. Default from VERCEL_GIT_COMMIT_SHA, GITHUB_SHA, … or `git rev-parse HEAD`. */
  commitSha?: string;
  /**
   * Upload source maps and create the release after `next build`. `'auto'` (default) uploads when
   * TALARIA_RELEASE_KEY is set. Use `false` to upload at deploy time with `talaria-nextjs upload`.
   */
  uploadSourceMaps?: boolean | 'auto';
  /** Options passed to the post-build upload (url, apiKey, projectId, …). */
  upload?: Omit<FinalizeOptions, 'projectDir' | 'distDir' | 'release' | 'commitSha'>;
  /** Do not log. */
  silent?: boolean;
}

type WebpackContext = { isServer?: boolean };
type WebpackConfig = {
  resolve?: {
    alias?: Record<string, string | false>;
    fallback?: Record<string, string | false>;
  };
};

type AfterCompile = (ctx: { distDir: string; projectDir: string }) => Promise<void> | void;

type NextConfig = {
  serverExternalPackages?: string[];
  transpilePackages?: string[];
  productionBrowserSourceMaps?: boolean;
  distDir?: string;
  env?: Record<string, string | undefined>;
  compiler?: Record<string, unknown> & { runAfterProductionCompile?: AfterCompile };
  webpack?: (config: WebpackConfig, context: WebpackContext) => WebpackConfig;
  turbopack?: Record<string, unknown>;
};

/**
 * Wrap `next.config`:
 * - tags every event with the release and commit (inlined NEXT_PUBLIC_TALARIA_RELEASE /
 *   NEXT_PUBLIC_TALARIA_COMMIT_SHA, read by the browser, server and edge SDKs);
 * - after `next build` (`compiler.runAfterProductionCompile`, Next 15.4+), creates the release
 *   with its commits, uploads `.next/static` maps as `_next/static/...` and deletes them;
 * - keeps the Node SDK out of client bundles.
 */
export function withTalariaConfig<T extends object>(
  input: T = {} as T,
  options: TalariaNextConfig = {},
): T {
  const nextConfig = input as T & NextConfig;
  const env = process.env;
  const hide = options.hideSourceMaps !== false;
  const log = options.silent ? () => {} : (l: string) => console.log(`[talaria] ${l}`);
  const identity = resolveBuildRelease({ release: options.release, commitSha: options.commitSha, env });
  const upload =
    options.uploadSourceMaps === true ||
    ((options.uploadSourceMaps ?? 'auto') === 'auto' && Boolean(options.upload?.apiKey ?? env.TALARIA_RELEASE_KEY));
  if (identity.release) log(`release ${identity.release}${identity.commitSha ? ` @ ${identity.commitSha.slice(0, 12)}` : ''} (${identity.source})`);

  const externals = new Set([
    ...(nextConfig.serverExternalPackages ?? []),
    '@newtalaria/node',
    '@newtalaria/core',
  ]);
  const transpile = new Set([
    ...(nextConfig.transpilePackages ?? []),
    '@newtalaria/nextjs',
    '@newtalaria/react',
    '@newtalaria/browser',
  ]);
  const previousWebpack = nextConfig.webpack;
  const previousAfter = nextConfig.compiler?.runAfterProductionCompile;
  const releaseEnv: Record<string, string> = {};
  if (identity.release) releaseEnv.NEXT_PUBLIC_TALARIA_RELEASE = identity.release;
  if (identity.commitSha) releaseEnv.NEXT_PUBLIC_TALARIA_COMMIT_SHA = identity.commitSha;

  return {
    ...(nextConfig as object),
    // An explicit next.config `env` wins, so apps can still pin their own values.
    env: { ...releaseEnv, ...(nextConfig.env ?? {}) },
    serverExternalPackages: [...externals],
    transpilePackages: [...transpile],
    // Next 16 builds with Turbopack and refuses a `webpack` hook without a `turbopack` key.
    // The Node SDK stays server-only through serverExternalPackages there.
    turbopack: nextConfig.turbopack ?? {},
    productionBrowserSourceMaps: upload ? true : hide ? false : nextConfig.productionBrowserSourceMaps,
    compiler: {
      ...(nextConfig.compiler ?? {}),
      async runAfterProductionCompile(ctx: { distDir: string; projectDir: string }) {
        if (previousAfter) await previousAfter(ctx);
        if (!upload) return;
        await finalizeTalariaRelease({
          ...(options.upload ?? {}),
          projectDir: ctx.projectDir,
          distDir: ctx.distDir ? relativeDist(ctx.projectDir, ctx.distDir) : nextConfig.distDir,
          release: identity.release,
          commitSha: identity.commitSha,
          deleteSourceMaps: hide,
          log: options.silent ? () => {} : undefined,
        });
      },
    },
    webpack(config: WebpackConfig, context: WebpackContext) {
      if (!context.isServer) {
        config.resolve = config.resolve ?? {};
        config.resolve.alias = {
          ...config.resolve.alias,
          '@newtalaria/node': false,
          '@newtalaria/node/api': false,
        };
        config.resolve.fallback = {
          ...config.resolve.fallback,
          http: false,
          https: false,
          net: false,
          tls: false,
        };
      }
      return previousWebpack ? previousWebpack(config, context) : config;
    },
  } as T;
}

function relativeDist(projectDir: string, distDir: string): string {
  return distDir.startsWith(projectDir) ? distDir.slice(projectDir.length).replace(/^[\\/]+/, '') || '.next' : distDir;
}
