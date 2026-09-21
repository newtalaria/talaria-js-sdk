import {
  buildFailedRequestIgnoreUrls,
  isAllowedNetworkOrigin,
  resolveRequestOrigin,
  urlMatchesIgnoreList,
} from '../replay/hooks.js';

export interface TraceparentInjectOptions {
  networkErrorOrigins: string[];
  pageOrigin?: string;
  talariaBaseUrl?: string;
  failedRequestIgnoreUrls?: string[];
}

/**
 * Whether an outbound fetch/XHR should receive `traceparent`.
 * Same origin policy as failed-request promotion (`networkErrorOrigins`).
 */
export function shouldInjectTraceparent(
  rawUrl: string,
  opts: TraceparentInjectOptions,
): boolean {
  const ignore = buildFailedRequestIgnoreUrls(
    opts.failedRequestIgnoreUrls ?? [],
    opts.talariaBaseUrl,
  );
  if (urlMatchesIgnoreList(rawUrl, ignore)) return false;
  const origin = resolveRequestOrigin(rawUrl, opts.pageOrigin);
  return isAllowedNetworkOrigin(origin, {
    networkErrorOrigins: opts.networkErrorOrigins,
    pageOrigin: opts.pageOrigin,
  });
}

/** Skip Talaria ingest/replay/span traffic when creating HTTP child spans. */
export function isTalariaIngestUrl(
  rawUrl: string,
  opts: { talariaBaseUrl?: string; failedRequestIgnoreUrls?: string[] },
): boolean {
  const ignore = buildFailedRequestIgnoreUrls(
    opts.failedRequestIgnoreUrls ?? [],
    opts.talariaBaseUrl,
  );
  return urlMatchesIgnoreList(rawUrl, ignore);
}

/**
 * Framework / CDN telemetry that is not a product HTTP call.
 * Next.js App Router prefetch (`__next.*` RSC, `/_next/`) and Cloudflare RUM
 * would otherwise keep a navigation transaction open and flood the waterfall.
 */
export function isNoisyBrowserSpanUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  let path = rawUrl;
  try {
    const parsed = new URL(rawUrl, 'http://local.invalid');
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    // keep raw
  }
  const lower = path.toLowerCase();
  return (
    lower.includes('/cdn-cgi/') ||
    lower.includes('/_next/') ||
    lower.includes('__next.')
  );
}
