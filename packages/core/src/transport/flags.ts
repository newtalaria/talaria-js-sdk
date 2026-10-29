import type { ServerpodTransport } from './serverpod.js';

export interface EvaluateFlagsInput {
  anonymousId?: string;
  userId?: string;
  organizationId?: string;
  sessionId?: string;
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
 * Evaluate feature flags for the current visitor.
 *
 * `POST {baseUrl}/v1/flags/evaluate` (`flags:evaluate`, pk or sk).
 * Body: `{anonymousId, userId, organizationId, sessionId, attributes, keys}`.
 */
export async function evaluateFlags(
  transport: ServerpodTransport,
  input: EvaluateFlagsInput,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (input.anonymousId) body.anonymousId = input.anonymousId;
  if (input.userId) body.userId = input.userId;
  if (input.organizationId) body.organizationId = input.organizationId;
  if (input.sessionId) body.sessionId = input.sessionId;
  if (input.attributes && Object.keys(input.attributes).length > 0) {
    body.attributes = input.attributes;
  }
  if (input.keys && input.keys.length > 0) body.keys = input.keys;

  const response = await transport.call('v1/flags', 'evaluate', body);
  return unwrapServerpodResult(response);
}

/**
 * List flag definitions. `GET {baseUrl}/v1/flags?keys=` (`flags:read`, sk only).
 */
export async function listFlagDefinitions(
  transport: ServerpodTransport,
  keys?: string[],
): Promise<Record<string, unknown>> {
  const query: Record<string, unknown> = {};
  if (keys && keys.length > 0) query.keys = keys.join(',');
  const response = await transport.call('v1', 'flags', query, { method: 'GET' });
  return unwrapServerpodResult(response);
}
