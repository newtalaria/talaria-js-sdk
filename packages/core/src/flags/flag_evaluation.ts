/** One flag evaluation returned by `POST /flags/evaluate`. */
export interface FlagEvaluationResult {
  key: string;
  variationKey: string;
  /** Decoded `valueJson` (boolean, string, number, object, array, or null). */
  value: unknown;
  version: number;
  reason?: string;
  /** Raw wire payload when present. */
  valueJson?: string;
}

export function decodeValueJson(valueJson: string | null | undefined): unknown {
  if (valueJson == null || valueJson === '') return null;
  try {
    return JSON.parse(valueJson) as unknown;
  } catch {
    return valueJson;
  }
}

export function encodeValueJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(value == null ? null : String(value));
  }
}

export function flagEvaluationFromWire(
  raw: Record<string, unknown>,
): FlagEvaluationResult {
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  const variationKey =
    typeof raw.variationKey === 'string' ? raw.variationKey.trim() : '';
  const version =
    typeof raw.version === 'number'
      ? Math.floor(raw.version)
      : typeof raw.version === 'string'
        ? Number.parseInt(raw.version, 10) || 0
        : 0;
  const reason = typeof raw.reason === 'string' ? raw.reason : undefined;
  const valueJson =
    typeof raw.valueJson === 'string' ? raw.valueJson : undefined;
  return {
    key,
    variationKey,
    value: decodeValueJson(valueJson),
    version,
    reason,
    valueJson,
  };
}

export function flagEvaluationToCacheJson(
  result: FlagEvaluationResult,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    key: result.key,
    variationKey: result.variationKey,
    valueJson: result.valueJson ?? encodeValueJson(result.value),
    version: result.version,
  };
  if (result.reason != null) out.reason = result.reason;
  return out;
}
