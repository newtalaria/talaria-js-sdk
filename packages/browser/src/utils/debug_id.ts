import type { DebugImage, DebugMeta, ExceptionData } from '../types.js';

export function readDebugIdRegistry(
  registry: Record<string, unknown> | undefined = readGlobalRegistry(),
): Record<string, string> {
  if (!registry) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(registry)) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || id.length > 80 || /\s/.test(id)) continue;
    out[key] = id;
  }
  return out;
}

export function debugMetaForException(
  exception: ExceptionData | undefined,
  registry: Record<string, string> = readDebugIdRegistry(),
): DebugMeta | undefined {
  if (!exception) return undefined;
  const frames = exception.values.flatMap(
    (value) => value.stacktrace?.frames ?? [],
  );
  return debugMetaForFrames(frames, registry);
}

export function debugMetaForFrames(
  frames: Array<{ absPath?: string; filename?: string }>,
  registry: Record<string, string>,
): DebugMeta | undefined {
  const images: DebugImage[] = [];
  const seen = new Set<string>();
  for (const frame of frames) {
    const ref = frame.absPath || frame.filename;
    if (!ref) continue;
    const id = lookupDebugId(registry, ref);
    if (!id) continue;
    const key = `${id}\n${scriptKey(ref)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    images.push({ type: 'sourcemap', codeFile: ref, debugId: id });
  }
  return images.length ? { images } : undefined;
}

function lookupDebugId(
  registry: Record<string, string>,
  ref: string,
): string | undefined {
  const want = scriptKey(ref);
  if (registry[ref]) return registry[ref];
  if (registry[want]) return registry[want];
  for (const [key, id] of Object.entries(registry)) {
    if (scriptKey(key) === want) return id;
  }
  return undefined;
}

function scriptKey(value: string): string {
  const noQuery = value.split('?')[0]?.split('#')[0] ?? value;
  return noQuery.replace(/:\d+:\d+$/, '');
}

function readGlobalRegistry(): Record<string, unknown> | undefined {
  const holder = globalThis as typeof globalThis & {
    __talariaDebugIds?: Record<string, unknown>;
  };
  const raw = holder.__talariaDebugIds;
  if (!raw || typeof raw !== 'object') return undefined;
  return raw;
}
