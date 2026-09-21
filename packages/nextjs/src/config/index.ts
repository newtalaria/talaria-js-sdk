export interface TalariaNextConfig {
  /** Widen Next externals so Node SDK stays on the server. */
  hideSourceMaps?: boolean;
}

type NextConfig = Record<string, unknown> & {
  serverExternalPackages?: string[];
  productionBrowserSourceMaps?: boolean;
};

/**
 * Wrap `next.config` — does **not** upload source maps (Talaria has no
 * symbolication worker). Sets `hideSourceMaps` / externals only.
 */
export function withTalariaConfig<T extends NextConfig>(
  nextConfig: T = {} as T,
  options: TalariaNextConfig = {},
): T {
  const hide = options.hideSourceMaps !== false;
  const externals = new Set([
    ...(nextConfig.serverExternalPackages ?? []),
    '@newtalaria/node',
    '@newtalaria/core',
  ]);
  return {
    ...nextConfig,
    serverExternalPackages: [...externals],
    productionBrowserSourceMaps: hide
      ? false
      : nextConfig.productionBrowserSourceMaps,
  };
}
