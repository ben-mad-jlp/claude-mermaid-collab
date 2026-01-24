/**
 * MCP SSE Handler
 *
 * Manages MCP server instances over SSE connections.
 * Each SSE connection gets its own MCP server instance.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { BunSSEServerTransport } from './sse-transport.js';
import { setupMCPServer } from './setup.js';

// Active SSE sessions
const sessions = new Map<string, {
  transport: BunSSEServerTransport;
  server: Server;
}>();

/**
 * Handle GET request to establish SSE connection
 */
export async function handleSSEConnection(req: Request): Promise<Response> {
  const transport = new BunSSEServerTransport('/mcp/message');

  // Create and setup MCP server
  const server = await setupMCPServer();

  // Store session
  sessions.set(transport.sessionId, { transport, server });

  // Connect server to transport
  await server.connect(transport);

  console.log(`[MCP SSE] New session: ${transport.sessionId}`);

  // Cleanup on close
  transport.onclose = () => {
    console.log(`[MCP SSE] Session closed: ${transport.sessionId}`);
    sessions.delete(transport.sessionId);
  };

  return transport.createSSEResponse();
}

/**
 * Handle POST request with message for a session
 */
export async function handleSSEMessage(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    return new Response('Missing sessionId', { status: 400 });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return new Response('Session not found', { status: 404 });
  }

  const body = await req.text();
  return session.transport.handlePostMessage(body);
}

/**
 * Get active session count
 */
export function getActiveSessionCount(): number {
  return sessions.size;
}
