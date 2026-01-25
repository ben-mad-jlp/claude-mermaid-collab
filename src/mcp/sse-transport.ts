/**
 * SSE Server Transport for Bun
 *
 * Adapts the MCP SSE transport pattern for Bun's Request/Response API.
 * Sends messages over SSE stream, receives via HTTP POST.
 */

import { randomUUID } from 'node:crypto';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

// Heartbeat interval in milliseconds (5 seconds for better connection stability)
const HEARTBEAT_INTERVAL = 5000;

export class BunSSEServerTransport implements Transport {
  private _sessionId: string;
  private _endpoint: string;
  private _controller: ReadableStreamDefaultController<string> | null = null;
  private _closed = false;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(endpoint: string, sessionId?: string) {
    this._endpoint = endpoint;
    this._sessionId = sessionId || randomUUID();
  }

  /**
   * Start sending heartbeat pings to keep the connection alive.
   */
  private _startHeartbeat(): void {
    this._heartbeatTimer = setInterval(() => {
      if (this._controller && !this._closed) {
        try {
          // Send a comment line as heartbeat (: is a comment in SSE)
          this._controller.enqueue(`: heartbeat ${Date.now()}\n\n`);
        } catch (error) {
          // Connection may have closed, stop heartbeat
          this._stopHeartbeat();
        }
      } else {
        this._stopHeartbeat();
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Stop the heartbeat timer.
   */
  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  get sessionId(): string {
    return this._sessionId;
  }

  /**
   * Creates the SSE Response for the initial connection.
   * Returns a Response with a ReadableStream for SSE.
   */
  createSSEResponse(): Response {
    const self = this;

    const stream = new ReadableStream<string>({
      start(controller) {
        self._controller = controller;

        // Send the endpoint event (tells client where to POST messages)
        const endpointUrl = `${self._endpoint}?sessionId=${self._sessionId}`;
        controller.enqueue(`event: endpoint\ndata: ${encodeURI(endpointUrl)}\n\n`);

        // Start heartbeat to keep connection alive
        self._startHeartbeat();
      },
      cancel() {
        self._stopHeartbeat();
        self._closed = true;
        self._controller = null;
        self.onclose?.();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  /**
   * Handles incoming POST messages from the client.
   */
  async handlePostMessage(body: string): Promise<Response> {
    if (!this._controller || this._closed) {
      return Response.json(
        { error: 'connection_closed', message: 'SSE connection not established or closed' },
        { status: 503 }
      );
    }

    try {
      const message = JSON.parse(body);
      await this.handleMessage(message);
      return new Response('Accepted', { status: 202 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.onerror?.(error instanceof Error ? error : new Error(errorMessage));
      return Response.json(
        { error: 'invalid_message', message: errorMessage },
        { status: 400 }
      );
    }
  }

  /**
   * Handle a client message.
   */
  async handleMessage(message: unknown): Promise<void> {
    let parsedMessage: JSONRPCMessage;
    try {
      parsedMessage = JSONRPCMessageSchema.parse(message);
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    this.onmessage?.(parsedMessage);
  }

  /**
   * Send a message to the client via SSE.
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._controller || this._closed) {
      throw new Error('Not connected');
    }

    const data = JSON.stringify(message);
    this._controller.enqueue(`event: message\ndata: ${data}\n\n`);
  }

  /**
   * Start the transport (no-op for SSE, connection starts with createSSEResponse).
   */
  async start(): Promise<void> {
    // Connection is started when createSSEResponse is called
  }

  /**
   * Close the SSE connection.
   */
  async close(): Promise<void> {
    this._stopHeartbeat();
    if (this._controller && !this._closed) {
      this._controller.close();
      this._controller = null;
      this._closed = true;
      this.onclose?.();
    }
  }
}
