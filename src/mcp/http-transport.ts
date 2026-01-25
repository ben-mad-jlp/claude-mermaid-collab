/**
 * Streamable HTTP Transport for MCP (Protocol Version 2025-03-26)
 *
 * Implements the Streamable HTTP transport which replaces the deprecated SSE transport.
 * Uses a single endpoint that handles both POST (client→server) and GET (server→client).
 *
 * This transport is simpler than SSE:
 * - Each client message is a POST request
 * - Server responds inline or via SSE stream
 * - No persistent connection required
 */

import { randomUUID } from 'node:crypto';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * Pending response that we're building up
 */
interface PendingResponse {
  resolve: (messages: JSONRPCMessage[]) => void;
  messages: JSONRPCMessage[];
  timeout: ReturnType<typeof setTimeout>;
}

export class StreamableHttpTransport implements Transport {
  private _sessionId: string;
  private _closed = false;
  private _currentResponse: PendingResponse | null = null;
  private _serverStreamController: ReadableStreamDefaultController<string> | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(sessionId?: string) {
    this._sessionId = sessionId || randomUUID();
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get isClosed(): boolean {
    return this._closed;
  }

  /**
   * Handle incoming POST request from client.
   * Parses the message, delivers to MCP server, and waits for response.
   */
  async handlePost(req: Request): Promise<Response> {
    if (this._closed) {
      return Response.json(
        { jsonrpc: '2.0', error: { code: -32000, message: 'Session closed' } },
        { status: 410, headers: { 'Mcp-Session-Id': this._sessionId } }
      );
    }

    try {
      const body = await req.text();
      const parsed = JSON.parse(body);

      // Validate message(s)
      const messages: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      const validatedMessages: JSONRPCMessage[] = [];

      for (const msg of messages) {
        validatedMessages.push(JSONRPCMessageSchema.parse(msg));
      }

      // Check if any are requests (need responses)
      const hasRequests = validatedMessages.some(
        msg => 'method' in msg && 'id' in msg && msg.id !== undefined
      );

      if (!hasRequests) {
        // Only notifications/responses - deliver and return 202
        for (const msg of validatedMessages) {
          this.onmessage?.(msg);
        }
        return new Response(null, {
          status: 202,
          headers: { 'Mcp-Session-Id': this._sessionId }
        });
      }

      // Has requests - need to wait for responses
      const responsePromise = new Promise<JSONRPCMessage[]>((resolve) => {
        this._currentResponse = {
          resolve,
          messages: [],
          timeout: setTimeout(() => {
            // Timeout - resolve with what we have
            if (this._currentResponse) {
              resolve(this._currentResponse.messages);
              this._currentResponse = null;
            }
          }, 60000)
        };
      });

      // Deliver messages to MCP server
      for (const msg of validatedMessages) {
        this.onmessage?.(msg);
      }

      // Wait for response(s)
      const responseMessages = await responsePromise;

      // Return response
      const responseBody = responseMessages.length === 1
        ? responseMessages[0]
        : responseMessages;

      return Response.json(responseBody, {
        headers: { 'Mcp-Session-Id': this._sessionId }
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid message';
      this.onerror?.(error instanceof Error ? error : new Error(message));
      return Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${message}` } },
        { status: 400, headers: { 'Mcp-Session-Id': this._sessionId } }
      );
    }
  }

  /**
   * Handle incoming GET request - opens SSE stream for server→client messages.
   * This is optional and only needed if server wants to push notifications.
   */
  handleGet(): Response {
    if (this._closed) {
      return Response.json(
        { error: 'session_closed' },
        { status: 410, headers: { 'Mcp-Session-Id': this._sessionId } }
      );
    }

    const self = this;
    const stream = new ReadableStream<string>({
      start(controller) {
        self._serverStreamController = controller;
      },
      cancel() {
        self._serverStreamController = null;
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Mcp-Session-Id': this._sessionId,
      },
    });
  }

  /**
   * Handle DELETE request - terminates session.
   */
  handleDelete(): Response {
    this.close();
    return new Response(null, { status: 204 });
  }

  /**
   * Send a message from server to client.
   * If there's a pending response, add to it. Otherwise queue for SSE.
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) {
      throw new Error('Transport is closed');
    }

    // If we have a pending response waiting, add this message
    if (this._currentResponse) {
      this._currentResponse.messages.push(message);

      // If this is a response (has result or error), we're done
      if ('result' in message || 'error' in message) {
        clearTimeout(this._currentResponse.timeout);
        this._currentResponse.resolve(this._currentResponse.messages);
        this._currentResponse = null;
      }
      return;
    }

    // No pending response - send via SSE stream if available
    if (this._serverStreamController) {
      const data = JSON.stringify(message);
      this._serverStreamController.enqueue(`data: ${data}\n\n`);
    }
  }

  /**
   * Start the transport (no-op for HTTP).
   */
  async start(): Promise<void> {
    // HTTP transport doesn't need explicit start
  }

  /**
   * Close the transport.
   */
  async close(): Promise<void> {
    if (!this._closed) {
      this._closed = true;

      // Resolve any pending response
      if (this._currentResponse) {
        clearTimeout(this._currentResponse.timeout);
        this._currentResponse.resolve(this._currentResponse.messages);
        this._currentResponse = null;
      }

      // Close SSE stream
      if (this._serverStreamController) {
        try {
          this._serverStreamController.close();
        } catch {
          // Ignore
        }
        this._serverStreamController = null;
      }

      this.onclose?.();
    }
  }
}
