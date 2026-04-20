/**
 * Agent Registry Manager
 *
 * Provides a singleton handle to the AgentSessionRegistry so MCP tools can
 * reach the EventLog (and other registry affordances) without circular
 * dependencies or direct imports from server.ts.
 */

import type { AgentSessionRegistry } from './session-registry.ts';

let globalAgentRegistry: AgentSessionRegistry | null = null;

export function initializeAgentRegistry(registry: AgentSessionRegistry): void {
  globalAgentRegistry = registry;
}

export function getAgentRegistry(): AgentSessionRegistry | null {
  return globalAgentRegistry;
}

export function hasAgentRegistry(): boolean {
  return globalAgentRegistry !== null;
}
