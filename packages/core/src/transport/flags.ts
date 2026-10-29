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
 * `GET {baseUrl}/v1/flags` with query parameters (API key auth, `flags:read` scope).
 */
export async function evaluateFlags(
  transport: ServerpodTransport,
  input: EvaluateFlagsInput,
): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {};
  if (input.anonymousId) params.anonymousId = input.anonymousId;
  if (input.userId) params.userId = input.userId;
  if (input.organizationId) params.organizationId = input.organizationId;
  if (input.attributes && Object.keys(input.attributes).length > 0) {
    params.attributes = input.attributes;
  }
  if (input.keys && input.keys.length > 0) params.keys = input.keys;

  const response = await transport.call('v1', 'flags', params, { method: 'GET' });
  return unwrapServerpodResult(response);
}
