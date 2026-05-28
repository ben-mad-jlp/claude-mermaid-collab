/**
 * Embeds API Client - HTTP fetch methods for embed operations
 */

import type { Embed } from '../types/embed';

const API_BASE = ''; // Use relative URLs (same host)

async function invoke(
  serverId: string,
  path: string,
  method: 'GET' | 'DELETE' = 'GET',
): Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<any> }> {
  const mc = (window as any).mc;
  if (mc?.invokeOnServer && serverId) {
    const res = await mc.invokeOnServer(serverId, { path, method });
    const ok = res?.ok ?? (typeof res?.status === 'number' ? res.status >= 200 && res.status < 300 : true);
    const status = res?.status ?? (ok ? 200 : 500);
    const statusText = res?.statusText ?? (ok ? 'OK' : 'Error');
    const body = res?.body ?? res?.data ?? res;
    return {
      ok,
      status,
      statusText,
      json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    };
  }
  const url = serverId ? `${API_BASE}/srv/${encodeURIComponent(serverId)}${path}` : `${API_BASE}${path}`;
  const response = await fetch(url, { method });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json(),
  };
}

/**
 * Embeds API client for managing session embeds
 */
export const embedsApi = {
  /**
   * Fetch all embeds for a session
   * GET /api/embeds?project={project}&session={session}
   * Returns: Embed[]
   */
  async fetchEmbeds(serverId: string, session: string, project: string): Promise<Embed[]> {
    const path = `/api/embeds?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await invoke(serverId, path, 'GET');
    if (!response.ok) {
      throw new Error(`Failed to fetch embeds: ${response.statusText}`);
    }
    const data = await response.json();
    return data?.embeds || [];
  },

  /**
   * Delete an embed from a session
   * DELETE /api/embed/{id}?project={project}&session={session}
   * Returns: void
   */
  async deleteEmbed(serverId: string, session: string, id: string, project: string): Promise<void> {
    const path = `/api/embed/${id}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await invoke(serverId, path, 'DELETE');
    if (!response.ok) {
      throw new Error(`Failed to delete embed: ${response.statusText}`);
    }
  },
};
