/**
 * WebSocket handler for terminal sessions
 *
 * Protocol:
 * Client → Server:
 *   { type: "input", data: string }      // Keyboard input
 *   { type: "resize", cols: number, rows: number }
 *
 * Server → Client:
 *   { type: "output", data: string }     // Terminal output
 *   { type: "exit", code: number }       // PTY process exited
 *   { type: "error", message: string }   // Error message
 */

import type { ServerWebSocket } from 'bun';
import { ptyManager } from '../terminal/index';

/** Client to Server messages */
type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

/** Server to Client messages */
type ServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };

/**
 * Terminal WebSocket data attached to each connection
 */
interface TerminalWebSocketData {
  sessionId: string;
  type: 'terminal';
}

/**
 * Send error message to WebSocket
 */
function sendError(ws: ServerWebSocket, message: string): void {
  try {
    ws.send(JSON.stringify({ type: 'error', message } as ServerMessage));
  } catch (error) {
    console.warn('Failed to send error message:', error);
  }
}

/**
 * Handle WebSocket open for terminal connection
 * Session ID is passed via ws.data.sessionId from the server upgrade
 */
export function handleTerminalOpen(ws: ServerWebSocket<TerminalWebSocketData>): void {
  // Session ID is set by server.ts during WebSocket upgrade
  const sessionId = ws.data?.sessionId;

  if (!sessionId) {
    sendError(ws, 'Missing or invalid session ID');
    try {
      ws.close();
    } catch {
      // Ignore close errors
    }
    return;
  }

  try {
    // Attach WebSocket to session (creates session if needed, replays buffer)
    ptyManager.attach(sessionId, ws);
    console.log(`Terminal WebSocket connected: session=${sessionId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to attach WebSocket to session ${sessionId}:`, error);
    sendError(ws, `Failed to connect to session: ${errorMessage}`);
    try {
      ws.close();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Handle incoming message from terminal WebSocket
 */
export function handleTerminalMessage(ws: ServerWebSocket<TerminalWebSocketData>, message: string | Buffer): void {
  const sessionId = ws.data.sessionId;

  if (!sessionId) {
    sendError(ws, 'Session ID not initialized');
    return;
  }

  // Parse message as JSON
  let parsed: ClientMessage;
  try {
    const str = typeof message === 'string' ? message : message.toString('utf-8');
    parsed = JSON.parse(str) as ClientMessage;
  } catch (error) {
    console.warn(`Invalid JSON from terminal WebSocket: ${message}`);
    sendError(ws, 'Invalid message format');
    return;
  }

  // Validate and handle message type
  try {
    if (parsed.type === 'input') {
      if (typeof parsed.data !== 'string') {
        sendError(ws, 'Invalid input message: data must be a string');
        return;
      }
      ptyManager.write(sessionId, parsed.data);
    } else if (parsed.type === 'resize') {
      if (typeof parsed.cols !== 'number' || typeof parsed.rows !== 'number') {
        sendError(ws, 'Invalid resize message: cols and rows must be numbers');
        return;
      }
      ptyManager.resize(sessionId, parsed.cols, parsed.rows);
    } else {
      console.warn(`Unknown message type: ${(parsed as any).type}`);
      sendError(ws, `Unknown message type: ${(parsed as any).type}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error handling terminal message for session ${sessionId}:`, error);
    sendError(ws, errorMessage);
  }
}

/**
 * Handle WebSocket close for terminal connection
 */
export function handleTerminalClose(ws: ServerWebSocket<TerminalWebSocketData>): void {
  const sessionId = ws.data.sessionId;

  if (!sessionId) {
    return;
  }

  try {
    ptyManager.detach(sessionId, ws);
    console.log(`Terminal WebSocket disconnected: session=${sessionId}`);
  } catch (error) {
    console.error(`Error detaching WebSocket from session ${sessionId}:`, error);
  }
}

/**
 * Handle WebSocket error for terminal connection
 */
export function handleTerminalError(ws: ServerWebSocket<TerminalWebSocketData>, error: Error): void {
  const sessionId = ws.data.sessionId;

  console.error(`Terminal WebSocket error for session ${sessionId}:`, error);

  if (sessionId) {
    try {
      ptyManager.detach(sessionId, ws);
    } catch (detachError) {
      console.error(`Error detaching WebSocket on error:`, detachError);
    }
  }
}
