import type { ServerpodTransport } from './serverpod.js';

export interface EvaluateFlagsInput {
  anonymousId?: string;
  userId?: string;
  organizationId?: string;
  attributes?: Record<string, string>;
  keys?: string[];
}

function unwrapServerpodResult(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const map = raw as Record<string, unknown>;
  const data = map.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return map;
}

/**
 * Evaluate feature flags for the current visitor context.
 *
 * `POST {baseUrl}/flags/evaluate` with `__className__: 'EvaluateFlagsInput'`.
 */
export async function evaluateFlags(
  transport: ServerpodTransport,
  input: EvaluateFlagsInput,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    __className__: 'EvaluateFlagsInput',
  };
  if (input.anonymousId) body.anonymousId = input.anonymousId;
  if (input.userId) body.userId = input.userId;
  if (input.organizationId) body.organizationId = input.organizationId;
  if (input.attributes && Object.keys(input.attributes).length > 0) {
    body.attributes = input.attributes;
  }
  if (input.keys && input.keys.length > 0) body.keys = input.keys;

  const response = await transport.call('flags', 'evaluate', { input: body });
  return unwrapServerpodResult(response);
}
