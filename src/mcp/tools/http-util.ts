/**
 * Shared HTTP/util helpers for MCP tool handlers.
 *
 * Extracted from setup.ts so domain tool modules (documents, session-todos, …)
 * can be self-contained ToolDefs without depending on setup.ts internals.
 */

import { getAuthToken } from '../../services/config-file.js';

// Configuration — mirrors the values used by the HTTP/API backend.
const API_PORT = parseInt(process.env.PORT || '9002', 10);
const API_HOST = process.env.HOST || 'localhost';
export const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

/**
 * fetch() wrapper for calls into this server's own /api/* (or /mcp) surface.
 * Attaches the configured bearer token so requests aren't rejected when
 * MERMAID_REQUIRE_AUTH_ON_LOOPBACK is on. Reads the token fresh each call so
 * a rotated token is picked up without a restart.
 */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

/**
 * Build an API URL with `project` + `session` query params (plus any extras).
 */
export function buildUrl(
  path: string,
  project: string,
  session: string,
  extraParams?: Record<string, string>,
): string {
  const url = new URL(path, API_BASE_URL);
  url.searchParams.set('project', project);
  url.searchParams.set('session', session);
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

// Loose JSON shape for arbitrary API response bodies. The MCP setup glues
// many internal HTTP endpoints together; rather than declaring a precise
// type for every payload, we treat them as generic key/value records and
// rely on runtime callers to extract the fields they need. This keeps the
// surface tsc-clean without weakening overall strict mode.
export type AnyJson = Record<string, any>;

export async function asJson(res: Response): Promise<AnyJson> {
  return (await res.json()) as AnyJson;
}

/** Session params description shared across tool input schemas. */
export const sessionParamsDesc = {
  project: {
    type: 'string',
    description: 'Absolute path to the project root directory',
  },
  session: {
    type: 'string',
    description: 'Session name (e.g., "bright-calm-river").',
  },
};
