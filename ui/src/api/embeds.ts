/**
 * Embeds API Client - HTTP fetch methods for embed operations
 */

import type { Embed } from '../types/embed';

const API_BASE = ''; // Use relative URLs (same host)

/**
 * Embeds API client for managing session embeds
 */
export const embedsApi = {
  /**
   * Fetch all embeds for a session
   * GET /api/embeds?project={project}&session={session}
   * Returns: Embed[]
   */
  async fetchEmbeds(session: string, project: string): Promise<Embed[]> {
    try {
      const response = await fetch(
        `${API_BASE}/api/embeds?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch embeds: ${response.statusText}`);
      }

      const data = await response.json();
      return data.embeds || [];
    } catch (error) {
      throw error;
    }
  },

  /**
   * Delete an embed from a session
   * DELETE /api/embed/{id}?project={project}&session={session}
   * Returns: void
   */
  async deleteEmbed(session: string, id: string, project: string): Promise<void> {
    try {
      const response = await fetch(
        `${API_BASE}/api/embed/${id}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`,
        {
          method: 'DELETE',
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to delete embed: ${response.statusText}`);
      }
    } catch (error) {
      throw error;
    }
  },
};
