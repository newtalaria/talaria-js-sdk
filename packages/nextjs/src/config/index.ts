export interface TalariaNextConfig {
  /** Widen Next externals so Node SDK stays on the server. */
  hideSourceMaps?: boolean;
}

type WebpackContext = { isServer?: boolean };
type WebpackConfig = {
  resolve?: {
    alias?: Record<string, string | false>;
    fallback?: Record<string, string | false>;
  };
};

type NextConfig = Record<string, unknown> & {
  serverExternalPackages?: string[];
  transpilePackages?: string[];
  productionBrowserSourceMaps?: boolean;
  webpack?: (config: WebpackConfig, context: WebpackContext) => WebpackConfig;
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
  const transpile = new Set([
    ...(nextConfig.transpilePackages ?? []),
    '@newtalaria/nextjs',
    '@newtalaria/react',
    '@newtalaria/browser',
  ]);
  const previousWebpack = nextConfig.webpack;
  return {
    ...nextConfig,
    serverExternalPackages: [...externals],
    transpilePackages: [...transpile],
    productionBrowserSourceMaps: hide
      ? false
      : nextConfig.productionBrowserSourceMaps,
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
  };
}
