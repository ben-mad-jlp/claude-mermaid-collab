/**
 * MCP SSE Handler
 *
 * Manages MCP server instances over SSE connections.
 * Each SSE connection gets its own MCP server instance.
 *
 * Improvements:
 * - Session grace period: sessions stay alive briefly after disconnect
 * - Better error responses: JSON with error codes for client handling
 * - Detailed logging: track session lifecycle
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { BunSSEServerTransport } from './sse-transport.js';
import { setupMCPServer } from './setup.js';

// Session grace period - keep sessions alive for 60 seconds after disconnect
// This allows reconnection if the SSE stream drops temporarily
const SESSION_GRACE_PERIOD_MS = 60_000;

// Session cleanup interval
const CLEANUP_INTERVAL_MS = 30_000;

interface MCPSession {
  transport: BunSSEServerTransport;
  server: Server;
  createdAt: number;
  lastActivity: number;
  disconnectedAt: number | null;
}

// Active SSE sessions
const sessions = new Map<string, MCPSession>();

// Start cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    // Remove sessions that have been disconnected past the grace period
    if (session.disconnectedAt && (now - session.disconnectedAt > SESSION_GRACE_PERIOD_MS)) {
      console.log(`[MCP SSE] Cleaning up expired session: ${sessionId}`);
      sessions.delete(sessionId);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Handle GET request to establish SSE connection
 */
export async function handleSSEConnection(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const existingSessionId = url.searchParams.get('sessionId');

  // Check if reconnecting to an existing session
  if (existingSessionId && sessions.has(existingSessionId)) {
    const existingSession = sessions.get(existingSessionId)!;

    // Only allow reconnection if within grace period
    if (existingSession.disconnectedAt) {
      console.log(`[MCP SSE] Reconnecting to existing session: ${existingSessionId}`);

      // Create new transport but reuse the server
      const transport = new BunSSEServerTransport('/mcp/message', existingSessionId);

      // Update session
      existingSession.transport = transport;
      existingSession.disconnectedAt = null;
      existingSession.lastActivity = Date.now();

      // Reconnect server to new transport
      await existingSession.server.connect(transport);

      // Setup close handler
      transport.onclose = () => {
        console.log(`[MCP SSE] Session disconnected: ${existingSessionId}`);
        existingSession.disconnectedAt = Date.now();
      };

      return transport.createSSEResponse();
    }
  }

  // Create new session
  const transport = new BunSSEServerTransport('/mcp/message');
  const sessionId = transport.sessionId;

  // Create and setup MCP server
  const server = await setupMCPServer();

  // Store session
  const session: MCPSession = {
    transport,
    server,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    disconnectedAt: null,
  };
  sessions.set(sessionId, session);

  // Connect server to transport
  await server.connect(transport);

  console.log(`[MCP SSE] New session created: ${sessionId} (total: ${sessions.size})`);

  // Cleanup on close - but keep session in grace period
  transport.onclose = () => {
    console.log(`[MCP SSE] Session disconnected: ${sessionId} (entering grace period)`);
    session.disconnectedAt = Date.now();
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
    return Response.json(
      { error: 'missing_session_id', message: 'Missing sessionId parameter' },
      { status: 400 }
    );
  }

  const session = sessions.get(sessionId);

  if (!session) {
    console.log(`[MCP SSE] Session not found: ${sessionId} (available: ${Array.from(sessions.keys()).join(', ') || 'none'})`);
    return Response.json(
      {
        error: 'session_not_found',
        message: 'Session not found. Client should reconnect.',
        shouldReconnect: true
      },
      { status: 404 }
    );
  }

  // Check if session is in disconnected state
  if (session.disconnectedAt) {
    console.log(`[MCP SSE] Session ${sessionId} is disconnected, rejecting message`);
    return Response.json(
      {
        error: 'session_disconnected',
        message: 'Session is disconnected. Client should reconnect.',
        shouldReconnect: true,
        sessionId
      },
      { status: 503 }
    );
  }

  // Update last activity
  session.lastActivity = Date.now();

  const body = await req.text();
  return session.transport.handlePostMessage(body);
}

/**
 * Get active session count
 */
export function getActiveSessionCount(): number {
  return sessions.size;
}

/**
 * Get connected session count (not in grace period)
 */
export function getConnectedSessionCount(): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (!session.disconnectedAt) count++;
  }
  return count;
}

/**
 * Get session info for debugging
 */
export function getSessionInfo(): Array<{
  sessionId: string;
  createdAt: number;
  lastActivity: number;
  connected: boolean;
}> {
  return Array.from(sessions.entries()).map(([sessionId, session]) => ({
    sessionId,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity,
    connected: !session.disconnectedAt,
  }));
}
