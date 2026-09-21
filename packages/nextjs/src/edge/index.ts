import {
  ingestEventBatch,
  ServerpodTransport,
  normalizeEnvironment,
  type CaptureContext,
  type CoreInitOptions,
} from '@newtalaria/core';

const PLATFORM = 'javascript';

let transport: ServerpodTransport | null = null;
let environment: 'production' | 'staging' | 'development' = 'production';
let release: string | undefined;

export function initEdge(options: CoreInitOptions): void {
  const baseUrl = (options.dsn || options.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('@newtalaria/nextjs/edge: init requires dsn or baseUrl');
  transport = new ServerpodTransport({ baseUrl, apiKey: options.apiKey });
  environment = normalizeEnvironment(String(options.environment));
  release = options.release;
}

export async function captureException(
  error: unknown,
  context?: CaptureContext,
): Promise<void> {
  if (!transport) return;
  const err = error instanceof Error ? error : new Error(String(error));
  try {
    await ingestEventBatch(transport, [
      {
        message: err.message || String(error),
        environment,
        level: 'error',
        eventType: 'error',
        title: err.name,
        stackTrace: err.stack,
        platform: PLATFORM,
        release,
        userId: context?.userId,
        extraJson: context?.extra ? JSON.stringify(context.extra) : undefined,
        tags: context?.tags,
      },
    ]);
  } catch (ingestError) {
    console.warn('@newtalaria/nextjs/edge: event ingest failed', ingestError);
  }
}

export const Talaria = {
  init: initEdge,
  captureException,
};

export default Talaria;
