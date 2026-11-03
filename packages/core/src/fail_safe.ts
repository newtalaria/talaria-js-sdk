/**
 * Fail-safe diagnostics (Talaria workspace D19). Talaria never throws into the
 * host app: a bad key or init option disables the client, and transport
 * faults are logged at most once per channel per interval.
 */

/** Milliseconds between two log lines for the same channel. */
export const TRANSPORT_LOG_INTERVAL_MS = 60_000;

let disabledWarned = false;
const lastLog = new Map<string, number>();

/** At most the first 8 characters of a key, for log lines. */
export function keyPreview(key: string | null | undefined): string {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return '';
  return trimmed.length > 8 ? `${trimmed.slice(0, 8)}…` : trimmed;
}

/** Message text for an error or any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return 'unknown error';
  }
}

function safeWarn(...args: unknown[]): void {
  try {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(...args);
    }
  } catch {
    /* a broken console must not reach the host */
  }
}

/**
 * The "Talaria is disabled" warning, once per process (once per page in the
 * browser). Returns true when it was logged.
 */
export function warnDisabledOnce(
  label: string,
  reason: string,
  apiKey?: string | null,
): boolean {
  if (disabledWarned) return false;
  disabledWarned = true;
  const preview = keyPreview(apiKey);
  const key = preview ? ` (key "${preview}")` : '';
  // Credential errors carry their own "@newtalaria/x: " or "Talaria: " prefix.
  const detail = reason.replace(/^(?:@newtalaria\/[\w/-]+|Talaria):\s*/, '');
  safeWarn(
    `${label}: Talaria is disabled: ${detail}${key}. The app keeps running and nothing is sent.`,
  );
  return true;
}

/**
 * Log a transport or internal fault at most once per
 * {@link TRANSPORT_LOG_INTERVAL_MS} per channel.
 */
export function logRateLimited(
  channel: string,
  message: string,
  detail?: unknown,
  now: number = Date.now(),
): boolean {
  const last = lastLog.get(channel);
  if (last !== undefined && now - last < TRANSPORT_LOG_INTERVAL_MS) return false;
  lastLog.set(channel, now);
  if (detail === undefined) safeWarn(message);
  else safeWarn(message, detail);
  return true;
}

/** Run a host-facing hook body; any Talaria fault is logged, never thrown. */
export function guard(channel: string, label: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    logRateLimited(channel, `${label}: internal error (ignored)`, error);
  }
}

/** Await a Talaria promise; any rejection is logged, never thrown. */
export async function guardAsync(
  channel: string,
  label: string,
  fn: () => Promise<unknown> | unknown,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logRateLimited(channel, `${label}: internal error (ignored)`, error);
  }
}

/** @internal Reset between tests. */
export function resetFailSafe(): void {
  disabledWarned = false;
  lastLog.clear();
}
