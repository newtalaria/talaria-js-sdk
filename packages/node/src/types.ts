import type { CoreInitOptions } from '@newtalaria/core';

export interface TalariaNodeInitOptions extends CoreInitOptions {
  /** Disable process `uncaughtException` / `unhandledRejection` handlers. */
  disableDefaultIntegrations?: boolean;
  /**
   * Extra URL substrings that must never be traced (Talaria ingest URLs are
   * always skipped).
   */
  failedRequestIgnoreUrls?: string[];
  /** Service name written on span `resource`. Default `node`. */
  serviceName?: string;
}
