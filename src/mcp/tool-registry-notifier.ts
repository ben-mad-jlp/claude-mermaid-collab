/**
 * MCP Server Registry and Tool List Change Notifications
 *
 * Maintains a registry of connected MCP servers and provides a mechanism to
 * notify all of them when the available tool list changes (e.g., when the
 * Electron bridge becomes available or unavailable).
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Registry of all currently connected MCP servers
const _servers = new Set<Server>();

/**
 * Register an MCP server to receive tool list change notifications.
 * Called when a new server connects.
 */
export function registerMcpServer(server: Server): void {
  _servers.add(server);
}

/**
 * Unregister an MCP server so it no longer receives notifications.
 * Called when a server disconnects or a session is terminated.
 */
export function unregisterMcpServer(server: Server): void {
  _servers.delete(server);
}

/**
 * Notify all registered servers that the available tool list has changed.
 * Sends the 'notifications/tools/list_changed' notification to each server.
 *
 * @param reason - A string describing why the tool list changed (e.g., 'desktop-bridge')
 *                 This is logged for debugging but not sent in the notification.
 */
export function notifyToolListChanged(reason: string): void {
  for (const server of _servers) {
    // Fire-and-catch each server independently so one dead transport's rejection
    // doesn't prevent delivery to the others.
    server
      .notification({
        method: 'notifications/tools/list_changed',
      })
      .catch((e) => {
        console.warn(
          '[mcp] Failed to send notifications/tools/list_changed to server:',
          e instanceof Error ? e.message : String(e),
        );
      });
  }
}
