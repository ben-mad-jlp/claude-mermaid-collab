import type { ServerWebSocket, Subprocess, Terminal } from 'bun';
import { RingBuffer } from './RingBuffer';
import { existsSync } from 'fs';

export interface PTYSession {
  id: string;
  process: Subprocess<'ignore', 'ignore', 'ignore'>;
  terminal: Terminal;
  buffer: RingBuffer;
  websockets: Set<ServerWebSocket>;
  shell: string;
  cwd: string;
  createdAt: Date;
  lastActivity: Date;
}

export interface PTYSessionInfo {
  id: string;
  shell: string;
  cwd: string;
  createdAt: Date;
  lastActivity: Date;
  connectedClients: number;
}

export interface CreateOptions {
  shell?: string;      // Default: $SHELL or fallback chain
  cwd?: string;        // Default: process.cwd()
  cols?: number;       // Default: 80
  rows?: number;       // Default: 24
}

/**
 * Manages PTY sessions in-memory using Bun's native terminal API.
 * Singleton instance initialized at server startup.
 */
export class PTYManager {
  private sessions: Map<string, PTYSession> = new Map();

  constructor() {
    // Initialize empty sessions Map (done inline above)
  }

  /**
   * Determine shell to use
   */
  private getShell(requestedShell?: string): string {
    if (requestedShell) {
      if (!existsSync(requestedShell)) {
        throw new Error(`Shell not found: ${requestedShell}`);
      }
      return requestedShell;
    }

    const envShell = process.env.SHELL;
    if (envShell && existsSync(envShell)) {
      return envShell;
    }

    // Try fallback chain: zsh -> bash -> sh
    const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh'];
    for (const fallback of fallbacks) {
      if (existsSync(fallback)) {
        return fallback;
      }
    }

    throw new Error('No shell available');
  }

  /**
   * Create a new PTY session with the given ID.
   */
  async create(sessionId: string, options?: CreateOptions): Promise<PTYSessionInfo> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }

    if (!sessionId || !sessionId.trim()) {
      throw new Error('Invalid session ID');
    }

    const shell = this.getShell(options?.shell);
    const cwd = options?.cwd || process.cwd();
    const cols = options?.cols || 80;
    const rows = options?.rows || 24;

    // Create session object first so callbacks can reference it
    const session: PTYSession = {
      id: sessionId,
      process: null as any,
      terminal: null as any,
      buffer: new RingBuffer(),
      websockets: new Set(),
      shell,
      cwd,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    try {
      // Spawn shell with Bun's native terminal option (callback-based API)
      const proc = Bun.spawn([shell], {
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
        terminal: {
          cols,
          rows,
          // Called when data is received from the terminal
          data: (terminal, data) => {
            const text = new TextDecoder().decode(data);
            session.buffer.write(text);
            session.lastActivity = new Date();

            // Broadcast to all connected websockets
            for (const ws of session.websockets) {
              try {
                ws.send(JSON.stringify({ type: 'output', data: text }));
              } catch (error) {
                // WebSocket may have been closed, ignore
              }
            }
          },
          // Called when PTY stream closes
          exit: (terminal, exitCode, signal) => {
            console.log(`PTY session ${sessionId} exited: code=${exitCode}, signal=${signal}`);
            session.lastActivity = new Date();

            // Broadcast exit message
            for (const ws of session.websockets) {
              try {
                ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
              } catch (error) {
                // WebSocket already closed, ignore
              }
            }

            // Clean up session
            this.sessions.delete(sessionId);
          },
        },
      });

      session.process = proc as Subprocess<'ignore', 'ignore', 'ignore'>;
      session.terminal = proc.terminal!;

      // Handle process exit (backup cleanup)
      proc.exited.then((exitCode) => {
        if (this.sessions.has(sessionId)) {
          console.log(`PTY process exited for ${sessionId}: code=${exitCode}`);
          this.sessions.delete(sessionId);
        }
      });

    } catch (error) {
      throw new Error(`Failed to spawn PTY: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Store session
    this.sessions.set(sessionId, session);

    return {
      id: session.id,
      shell: session.shell,
      cwd: session.cwd,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      connectedClients: session.websockets.size,
    };
  }

  /**
   * Send input data to a PTY session.
   */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    try {
      session.terminal.write(data);
    } catch (error) {
      console.warn(`Failed to write to session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    session.lastActivity = new Date();
  }

  /**
   * Resize a PTY session.
   */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    try {
      session.terminal.resize(cols, rows);
    } catch (error) {
      console.warn(`Failed to resize session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    session.lastActivity = new Date();
  }

  /**
   * Attach a WebSocket to receive output and replay buffer.
   * Auto-creates session if it doesn't exist.
   */
  attach(sessionId: string, ws: ServerWebSocket): void {
    let session = this.sessions.get(sessionId);

    // Auto-create session if it doesn't exist
    if (!session) {
      const shell = this.getShell();
      const cwd = process.cwd();

      session = {
        id: sessionId,
        process: null as any,
        terminal: null as any,
        buffer: new RingBuffer(),
        websockets: new Set(),
        shell,
        cwd,
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      try {
        const proc = Bun.spawn([shell], {
          cwd,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
          },
          terminal: {
            cols: 80,
            rows: 24,
            data: (terminal, data) => {
              const text = new TextDecoder().decode(data);
              session!.buffer.write(text);
              session!.lastActivity = new Date();

              for (const connectedWs of session!.websockets) {
                try {
                  connectedWs.send(JSON.stringify({ type: 'output', data: text }));
                } catch (error) {
                  // WebSocket closed, ignore
                }
              }
            },
            exit: (terminal, exitCode, signal) => {
              console.log(`PTY session ${sessionId} exited: code=${exitCode}, signal=${signal}`);
              session!.lastActivity = new Date();

              for (const connectedWs of session!.websockets) {
                try {
                  connectedWs.send(JSON.stringify({ type: 'exit', code: exitCode }));
                } catch (error) {
                  // WebSocket closed, ignore
                }
              }

              this.sessions.delete(sessionId);
            },
          },
        });

        session.process = proc as Subprocess<'ignore', 'ignore', 'ignore'>;
        session.terminal = proc.terminal!;

        proc.exited.then((exitCode) => {
          if (this.sessions.has(sessionId)) {
            this.sessions.delete(sessionId);
          }
        });

        this.sessions.set(sessionId, session);
      } catch (error) {
        console.error(`Failed to auto-create session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }

    // Add WebSocket to session
    session.websockets.add(ws);

    // Replay buffer contents to this ws
    try {
      const bufferContents = session.buffer.getContents();
      if (bufferContents) {
        ws.send(JSON.stringify({ type: 'output', data: bufferContents }));
      }
    } catch (error) {
      console.warn(`Failed to replay buffer for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    session.lastActivity = new Date();
  }

  /**
   * Detach a WebSocket (PTY continues running).
   */
  detach(sessionId: string, ws: ServerWebSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.websockets.delete(ws);
  }

  /**
   * Kill a PTY session and cleanup.
   */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Broadcast exit message
    for (const ws of session.websockets) {
      try {
        ws.send(JSON.stringify({ type: 'exit', code: -1 }));
      } catch (error) {
        // WebSocket already closed, ignore
      }
    }

    // Close all websockets
    for (const ws of session.websockets) {
      try {
        ws.close();
      } catch (error) {
        // Already closed, ignore
      }
    }

    // Close terminal and kill process
    try {
      session.terminal.close();
    } catch (error) {
      // Already closed, ignore
    }

    try {
      session.process.kill();
    } catch (error) {
      // Already dead, ignore
    }

    // Clear buffer and remove session
    session.buffer.clear();
    this.sessions.delete(sessionId);
  }

  /**
   * List all active sessions
   */
  list(): PTYSessionInfo[] {
    const result: PTYSessionInfo[] = [];
    for (const session of this.sessions.values()) {
      result.push({
        id: session.id,
        shell: session.shell,
        cwd: session.cwd,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        connectedClients: session.websockets.size,
      });
    }
    return result;
  }

  /**
   * Check if a session exists
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get session info by ID
   */
  get(sessionId: string): PTYSessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    return {
      id: session.id,
      shell: session.shell,
      cwd: session.cwd,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      connectedClients: session.websockets.size,
    };
  }

  /**
   * Kill all sessions (for server shutdown)
   */
  killAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.kill(sessionId);
    }
  }
}

/**
 * Singleton instance
 */
export const ptyManager = new PTYManager();
