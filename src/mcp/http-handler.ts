/**
 * MCP Streamable HTTP Handler
 *
 * Manages MCP server instances over Streamable HTTP transport.
 *
 * Features:
 * - Single endpoint for all MCP communication
 * - Session management via Mcp-Session-Id header
 * - Graceful session timeout and cleanup
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHttpTransport } from './http-transport.js';
import { setupMCPServer } from './setup.js';

// Session timeout - sessions expire after 5 minutes of inactivity
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

// Cleanup interval
const CLEANUP_INTERVAL_MS = 60 * 1000;

interface MCPSession {
  transport: StreamableHttpTransport;
  server: Server;
  createdAt: number;
  lastActivity: number;
}

// Active sessions
const sessions = new Map<string, MCPSession>();

// Start cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      console.log(`[MCP HTTP] Cleaning up expired session: ${sessionId}`);
      session.transport.close();
      sessions.delete(sessionId);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Handle MCP HTTP request (single endpoint for POST, GET, DELETE)
 */
export async function handleMCPRequest(req: Request): Promise<Response> {
  const sessionId = req.headers.get('mcp-session-id');

  // Handle by method
  switch (req.method) {
    case 'POST':
      return handlePost(req, sessionId);
    case 'GET':
      return handleGet(req, sessionId);
    case 'DELETE':
      return handleDelete(req, sessionId);
    default:
      return Response.json(
        { error: 'method_not_allowed', message: `Method ${req.method} not allowed` },
        { status: 405 }
      );
  }
}

/**
 * Handle POST - client sends messages to server
 */
async function handlePost(req: Request, sessionId: string | null): Promise<Response> {
  let session: MCPSession;

  if (sessionId) {
    // Existing session
    const existing = sessions.get(sessionId);
    if (!existing) {
      return Response.json(
        { error: 'session_not_found', message: 'Session not found. Please reinitialize.' },
        { status: 404 }
      );
    }
    session = existing;
    session.lastActivity = Date.now();
  } else {
    // New session - this should be an Initialize request
    const transport = new StreamableHttpTransport();
    const server = await setupMCPServer();

    session = {
      transport,
      server,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    // Connect server to transport
    await server.connect(transport);

    // Store session
    sessions.set(transport.sessionId, session);

    console.log(`[MCP HTTP] New session: ${transport.sessionId} (total: ${sessions.size})`);
  }

  // Handle the POST request
  const response = await session.transport.handlePost(req);

  // Add session ID to response if not already present
  if (!response.headers.has('mcp-session-id')) {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Mcp-Session-Id', session.transport.sessionId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  return response;
}

/**
 * Handle GET - opens SSE stream for server→client messages
 */
async function handleGet(req: Request, sessionId: string | null): Promise<Response> {
  if (!sessionId) {
    return Response.json(
      { error: 'missing_session_id', message: 'Mcp-Session-Id header required for GET' },
      { status: 400 }
    );
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return Response.json(
      { error: 'session_not_found', message: 'Session not found' },
      { status: 404 }
    );
  }

  session.lastActivity = Date.now();
  return session.transport.handleGet();
}

/**
 * Handle DELETE - terminates session
 */
async function handleDelete(req: Request, sessionId: string | null): Promise<Response> {
  if (!sessionId) {
    return Response.json(
      { error: 'missing_session_id', message: 'Mcp-Session-Id header required for DELETE' },
      { status: 400 }
    );
  }

  const session = sessions.get(sessionId);
  if (!session) {
    // Session already gone - that's fine
    return new Response(null, { status: 204 });
  }

  console.log(`[MCP HTTP] Session terminated: ${sessionId}`);
  session.transport.close();
  sessions.delete(sessionId);

  return new Response(null, { status: 204 });
}

/**
 * Get active session count
 */
export function getActiveSessionCount(): number {
  return sessions.size;
}

/**
 * Get session info for debugging
 */
export function getSessionInfo(): Array<{
  sessionId: string;
  createdAt: number;
  lastActivity: number;
}> {
  return Array.from(sessions.entries()).map(([sessionId, session]) => ({
    sessionId,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity,
  }));
}
