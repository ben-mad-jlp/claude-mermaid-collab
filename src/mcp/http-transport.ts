/**
 * Streamable HTTP Transport for MCP (Protocol Version 2025-03-26)
 *
 * Uses a single endpoint that handles both POST (client→server) and GET (server→client).
 *
 * How it works:
 * - Each client message is a POST request
 * - Server responds inline or via streaming
 * - No persistent connection required
 */

import { randomUUID } from 'node:crypto';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * Options for handlePost
 */
interface HandlePostOptions {
  /** Timeout in ms. 0 or undefined = use default (60000). -1 = no timeout */
  timeout?: number;
}

/**
 * Pending response that we're building up
 */
interface PendingResponse {
  resolve: (messages: JSONRPCMessage[]) => void;
  messages: JSONRPCMessage[];
  timeout: ReturnType<typeof setTimeout> | null;
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
   * @param req - The incoming request
   * @param options - Optional configuration including timeout
   */
  async handlePost(req: Request, options?: HandlePostOptions): Promise<Response> {
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
      // Parse timeout option - use default 60000ms if undefined or 0
      let timeoutMs = options?.timeout;
      if (timeoutMs === undefined || timeoutMs === 0) {
        timeoutMs = 60000;
      }

      const responsePromise = new Promise<JSONRPCMessage[]>((resolve) => {
        // Create timeout handle only if timeout_ms !== -1
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        if (timeoutMs !== -1) {
          timeoutHandle = setTimeout(() => {
            // Timeout - resolve with what we have
            if (this._currentResponse) {
              resolve(this._currentResponse.messages);
              this._currentResponse = null;
            }
          }, timeoutMs);
        }

        this._currentResponse = {
          resolve,
          messages: [],
          timeout: timeoutHandle
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
        if (this._currentResponse.timeout !== null) {
          clearTimeout(this._currentResponse.timeout);
        }
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
        if (this._currentResponse.timeout !== null) {
          clearTimeout(this._currentResponse.timeout);
        }
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

// ─── Remote MCP Transport (client-side) ──────────────────────────────────────
// Connects outward to remote MCP servers over HTTP/SSE.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export type AuthMethod = 'oauth-pkce' | 'api-key' | 'none';

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_at?: number;
  scope?: string;
}

export interface ApiKeyCredential {
  type: 'api-key';
  key: string;
  header?: string;
}

export interface OAuthCredential {
  type: 'oauth';
  tokens: OAuthTokens;
  client_id: string;
  auth_url: string;
  token_url: string;
  redirect_uri: string;
  scope?: string;
}

export type StoredCredential = ApiKeyCredential | OAuthCredential;

export interface RemoteTransportOptions {
  serverUrl: string;
  serverName: string;
  auth?: AuthMethod;
  apiKey?: string;
  apiKeyHeader?: string;
  oauthClientId?: string;
  oauthAuthUrl?: string;
  oauthTokenUrl?: string;
  oauthRedirectUri?: string;
  oauthScope?: string;
  credentialsDir?: string;
}

export function credentialPath(serverName: string, dir?: string): string {
  const base = dir ?? join(homedir(), '.claude', 'credentials');
  return join(base, serverName + '.json');
}

export async function loadCredential(serverName: string, dir?: string): Promise<StoredCredential | null> {
  try {
    const text = await readFile(credentialPath(serverName, dir), 'utf-8');
    return JSON.parse(text) as StoredCredential;
  } catch {
    return null;
  }
}

export async function saveCredential(serverName: string, cred: StoredCredential, dir?: string): Promise<void> {
  const path = credentialPath(serverName, dir);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(cred, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export function generatePKCE(): { verifier: string; challenge: string; method: 'S256' } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

export function buildAuthorizationUrl(opts: {
  authUrl: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  verifier: string;
  state?: string;
}): string {
  const { verifier, challenge } = generatePKCE();
  void verifier; // verifier must be stored by caller before calling this
  const pkce = generatePKCE();
  const url = new URL(opts.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (opts.scope) url.searchParams.set('scope', opts.scope);
  if (opts.state) url.searchParams.set('state', opts.state);
  return url.toString();
}

export async function exchangeCodeForTokens(opts: {
  tokenUrl: string;
  code: string;
  clientId: string;
  redirectUri: string;
  verifier: string;
}): Promise<OAuthTokens> {
  const res = await fetch(opts.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      client_id: opts.clientId,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.verifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string | undefined,
    token_type: (data.token_type as string) ?? 'Bearer',
    expires_at: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope as string | undefined,
  };
}

export async function refreshAccessToken(opts: {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
}): Promise<OAuthTokens> {
  const res = await fetch(opts.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: opts.clientId,
      refresh_token: opts.refreshToken,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string | undefined) ?? opts.refreshToken,
    token_type: (data.token_type as string) ?? 'Bearer',
    expires_at: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope as string | undefined,
  };
}

export class RemoteMcpTransport implements Transport {
  onclose?: () => void;
  onerror?: (err: Error) => void;
  onmessage?: (msg: JSONRPCMessage) => void;

  private _opts: RemoteTransportOptions;
  private _abortController: AbortController | null = null;
  private _sessionId: string | null = null;
  private _credential: StoredCredential | null = null;

  constructor(opts: RemoteTransportOptions) {
    this._opts = opts;
  }

  private async _resolveAuthHeaders(): Promise<Record<string, string>> {
    if (!this._credential) return {};
    if (this._credential.type === 'api-key') {
      const header = this._credential.header ?? 'Authorization';
      const value = header === 'Authorization' ? `Bearer ${this._credential.key}` : this._credential.key;
      return { [header]: value };
    }
    // oauth
    let tokens = this._credential.tokens;
    if (tokens.expires_at && tokens.expires_at < Date.now() + 60_000 && tokens.refresh_token) {
      tokens = await refreshAccessToken({
        tokenUrl: this._credential.token_url,
        clientId: this._credential.client_id,
        refreshToken: tokens.refresh_token,
      });
      this._credential = { ...this._credential, tokens };
      await saveCredential(this._opts.serverName, this._credential, this._opts.credentialsDir);
    }
    return { Authorization: `Bearer ${tokens.access_token}` };
  }

  async start(): Promise<void> {
    const { auth = 'none', serverName, credentialsDir } = this._opts;

    if (auth === 'api-key' && this._opts.apiKey) {
      const cred: ApiKeyCredential = { type: 'api-key', key: this._opts.apiKey, header: this._opts.apiKeyHeader };
      await saveCredential(serverName, cred, credentialsDir);
      this._credential = cred;
    } else if (auth === 'oauth-pkce') {
      const stored = await loadCredential(serverName, credentialsDir);
      if (stored?.type === 'oauth') {
        this._credential = stored;
      } else {
        // Launch PKCE flow
        const pkce = generatePKCE();
        const redirectUri = this._opts.oauthRedirectUri ?? 'http://localhost:9999/callback';
        const redirectUrl = new URL(redirectUri);
        const state = randomBytes(8).toString('hex');
        const authUrl = new URL(this._opts.oauthAuthUrl!);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', this._opts.oauthClientId!);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('code_challenge', pkce.challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        if (this._opts.oauthScope) authUrl.searchParams.set('scope', this._opts.oauthScope);
        authUrl.searchParams.set('state', state);

        const code = await new Promise<string>((resolve, reject) => {
          const server = createServer((req, res) => {
            const u = new URL(req.url!, `http://localhost:${redirectUrl.port}`);
            if (u.searchParams.get('state') !== state) { res.end('Bad state'); reject(new Error('state mismatch')); return; }
            const c = u.searchParams.get('code');
            if (!c) { res.end('Missing code'); reject(new Error('missing code')); return; }
            res.end('Authorized. You can close this tab.');
            server.close();
            resolve(c);
          });
          server.listen(parseInt(redirectUrl.port || '9999'));
          console.log(`[mcp-http-transport] Open to authorize:\n${authUrl.toString()}`);
        });

        const tokens = await exchangeCodeForTokens({
          tokenUrl: this._opts.oauthTokenUrl!,
          code,
          clientId: this._opts.oauthClientId!,
          redirectUri,
          verifier: pkce.verifier,
        });
        const oauthCred: OAuthCredential = {
          type: 'oauth',
          tokens,
          client_id: this._opts.oauthClientId!,
          auth_url: this._opts.oauthAuthUrl!,
          token_url: this._opts.oauthTokenUrl!,
          redirect_uri: redirectUri,
          scope: this._opts.oauthScope,
        };
        await saveCredential(serverName, oauthCred, credentialsDir);
        this._credential = oauthCred;
      }
    }

    // Open SSE connection
    this._abortController = new AbortController();
    const headers = await this._resolveAuthHeaders();

    const res = await fetch(this._opts.serverUrl, {
      headers: { ...headers, Accept: 'text/event-stream' },
      signal: this._abortController.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`SSE connection failed: ${res.status}`);
    }

    const sessionId = res.headers.get('mcp-session-id');
    if (sessionId) this._sessionId = sessionId;

    const decoder = new TextDecoder();
    const reader = res.body.getReader();

    const pump = async () => {
      let buf = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const msg = JSON.parse(line.slice(6)) as JSONRPCMessage;
                this.onmessage?.(msg);
              } catch { /* ignore malformed */ }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          this.onerror?.(err);
        }
      }
      this.onclose?.();
    };
    pump().catch(() => {});
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const headers = await this._resolveAuthHeaders();
    if (this._sessionId) headers['mcp-session-id'] = this._sessionId;
    const res = await fetch(this._opts.serverUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    const sessionId = res.headers.get('mcp-session-id');
    if (sessionId) this._sessionId = sessionId;
    if (!res.ok) throw new Error(`MCP send failed: ${res.status}`);
  }

  async close(): Promise<void> {
    this._abortController?.abort();
    if (this._sessionId) {
      const headers = await this._resolveAuthHeaders();
      if (this._sessionId) headers['mcp-session-id'] = this._sessionId;
      await fetch(this._opts.serverUrl, { method: 'DELETE', headers }).catch(() => {});
    }
    this.onclose?.();
  }
}
