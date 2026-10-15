/** Longest title the SDK sends; the server shows it verbatim as the issue title. */
export const MAX_TITLE_LENGTH = 120;

/**
 * Issue title for an exception: `<Type>: <message>`, like Sentry. The server uses a non-empty
 * client title verbatim, so sending just the type produced bare "TypeError" issues.
 */
export function exceptionTitle(type: string | undefined, message: string | undefined): string {
  const t = (type ?? '').trim() || 'Error';
  const firstLine = (message ?? '').split('\n')[0]?.trim() ?? '';
  if (!firstLine || firstLine === t) return t;
  const combined = firstLine.startsWith(`${t}: `) ? firstLine : `${t}: ${firstLine}`;
  return combined.length <= MAX_TITLE_LENGTH ? combined : `${combined.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}
