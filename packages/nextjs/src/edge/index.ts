import {
  BreadcrumbBuffer,
  ingestEventBatch,
  mergeTags,
  normalizeBreadcrumb,
  Scope,
  ServerpodTransport,
  type Breadcrumb,
  type CaptureContext,
  type CoreInitOptions,
  type SeverityLevel,
  type UserContext,
} from '@newtalaria/core';

const PLATFORM = 'javascript';

const scope = new Scope();
const breadcrumbs = new BreadcrumbBuffer();

let transport: ServerpodTransport | null = null;
let release: string | undefined;
let commitSha: string | undefined;

export function initEdge(options: CoreInitOptions): void {
  const baseUrl = (options.dsn || options.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('@newtalaria/nextjs/edge: init requires dsn or baseUrl');
  transport = new ServerpodTransport({ baseUrl, apiKey: options.apiKey });
  release = options.release;
  commitSha = options.commitSha;
  scope.clear();
  if (options.userId) scope.setUser({ id: options.userId });
  if (options.tags) scope.setTags(options.tags);
}

export function setUser(user: UserContext | null): void {
  scope.setUser(user);
}

export function setTags(tags: Record<string, string>): void {
  scope.setTags(tags);
}

export function setTag(key: string, value: string): void {
  scope.setTag(key, value);
}

export function setExtra(key: string, value: unknown): void {
  scope.setExtra(key, value);
}

export function setContext(name: string, context: Record<string, unknown> | null): void {
  scope.setContext(name, context);
}

export function addBreadcrumb(
  crumb: Partial<Breadcrumb> & { type?: string; message?: string },
): void {
  breadcrumbs.add(normalizeBreadcrumb(crumb));
}

export async function captureException(
  error: unknown,
  context?: CaptureContext,
): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  await send({
    message: err.message || String(error),
    level: 'error',
    title: err.name,
    stackTrace: err.stack,
    context,
  });
}

export async function captureMessage(
  message: string,
  level: SeverityLevel = 'info',
  context?: CaptureContext,
): Promise<void> {
  await send({ message, level, context });
}

async function send(args: {
  message: string;
  level: SeverityLevel;
  title?: string;
  stackTrace?: string;
  context?: CaptureContext;
}): Promise<void> {
  if (!transport) return;
  const extra = scope.mergeCaptureExtra(args.context?.extra);
  const tags = mergeTags(scope.getTags(), args.context?.tags);
  const isError = args.level === 'error' || args.level === 'fatal';
  const trail = isError ? breadcrumbs.snapshot() : undefined;
  try {
    await ingestEventBatch(transport, [
      {
        message: args.message,
        level: args.level,
        eventType:
          args.level === 'fatal' || args.level === 'error'
            ? 'error'
            : args.level === 'warning'
              ? 'warning'
              : args.level === 'debug'
                ? 'debug'
                : 'info',
        title: args.title ?? args.context?.title,
        stackTrace: args.stackTrace,
        platform: PLATFORM,
        release,
        commitSha,
        userId: args.context?.userId ?? scope.getUserId(),
        extraJson: extra ? JSON.stringify(extra) : undefined,
        tags: Object.keys(tags).length ? tags : undefined,
        breadcrumbs: trail && trail.length ? trail : undefined,
      },
    ]);
  } catch (ingestError) {
    console.warn('@newtalaria/nextjs/edge: event ingest failed', ingestError);
  }
}

export const Talaria = {
  init: initEdge,
  captureException,
  captureMessage,
  setUser,
  setTag,
  setTags,
  setExtra,
  setContext,
  addBreadcrumb,
};

export default Talaria;
