import type { ServerWebSocket } from 'bun';
import type { Subprocess } from 'bun';
import { RingBuffer } from './RingBuffer';
import { existsSync } from 'fs';

export interface PTYSession {
  id: string;
  pty: Subprocess;
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
 * Manages PTY sessions in-memory, replacing tmux.
 * Singleton instance initialized at server startup.
 */
export class PTYManager {
  private sessions: Map<string, PTYSession> = new Map();

  constructor() {
    // Initialize empty sessions Map (done inline above)
  }

  /**
   * Create a new PTY session with the given ID.
   *
   * Errors:
   * - Throws if sessionId already exists
   * - Throws if no valid shell available
   * - Throws on spawn failure
   */
  async create(sessionId: string, options?: CreateOptions): Promise<PTYSessionInfo> {
    // 1. Check if sessionId already exists
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }

    // Validate sessionId is not empty/whitespace
    if (!sessionId || !sessionId.trim()) {
      throw new Error('Invalid session ID');
    }

    // 2. Determine shell
    let shell: string;
    if (options?.shell) {
      shell = options.shell;
    } else {
      const envShell = process.env.SHELL;
      if (envShell && existsSync(envShell)) {
        shell = envShell;
      } else {
        // Try fallback chain: zsh -> bash -> sh
        const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh'];
        let found = false;
        for (const fallback of fallbacks) {
          if (existsSync(fallback)) {
            shell = fallback;
            found = true;
            break;
          }
        }
        if (!found) {
          throw new Error('No shell available');
        }
      }
    }

    // 3. Verify shell exists
    if (!existsSync(shell)) {
      throw new Error(`Shell not found: ${shell}`);
    }

    // 4. Spawn PTY subprocess
    const cwd = options?.cwd || process.cwd();
    const cols = options?.cols || 80;
    const rows = options?.rows || 24;

    let pty: Subprocess;
    try {
      pty = Bun.spawn([shell], {
        cwd,
        env: process.env,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        pty: {
          cols,
          rows,
        },
      });
    } catch (error) {
      throw new Error(`Failed to spawn PTY: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 5. Create PTYSession object
    const session: PTYSession = {
      id: sessionId,
      pty,
      buffer: new RingBuffer(),
      websockets: new Set(),
      shell,
      cwd,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    // 6. Set up PTY output handler
    const handleOutput = async (data: Buffer) => {
      const text = data.toString('utf8');
      session.buffer.write(text);
      session.lastActivity = new Date();

      // Broadcast to all websockets
      for (const ws of session.websockets) {
        try {
          ws.send(JSON.stringify({ type: 'output', data: text }));
        } catch (error) {
          // WebSocket may have been closed, ignore
        }
      }
    };

    // 7. Set up PTY exit handler
    const handleExit = async () => {
      session.lastActivity = new Date();

      // Broadcast exit message
      for (const ws of session.websockets) {
        try {
          ws.send(JSON.stringify({ type: 'exit', code: -1 }));
        } catch (error) {
          // WebSocket may have been closed, ignore
        }
      }

      // Clean up session
      this.sessions.delete(sessionId);
    };

    // Attach handlers to the output stream
    (async () => {
      for await (const chunk of pty.stdout) {
        await handleOutput(chunk);
      }
      await handleExit();
    })().catch((error) => {
      console.error(`PTY output handler error for session ${sessionId}:`, error);
    });

    // 8. Store session in Map
    this.sessions.set(sessionId, session);

    // 9. Return session info
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
   * Throws if session not found.
   */
  write(sessionId: string, data: string): void {
    // 1. Get session from Map
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 2. Write data to session.pty.stdin
    try {
      session.pty.stdin?.write(data);
    } catch (error) {
      console.warn(`Failed to write to session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. Update session.lastActivity
    session.lastActivity = new Date();
  }

  /**
   * Resize a PTY session.
   * Throws if session not found.
   */
  resize(sessionId: string, cols: number, rows: number): void {
    // 1. Get session from Map
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 2. Call pty.resize if supported by Bun
    try {
      if (typeof (session.pty as any).resize === 'function') {
        (session.pty as any).resize(cols, rows);
      }
    } catch (error) {
      console.warn(`Failed to resize session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. Update session.lastActivity
    session.lastActivity = new Date();
  }

  /**
   * Attach a WebSocket to receive output and replay buffer.
   * Auto-creates session if it doesn't exist.
   */
  attach(sessionId: string, ws: ServerWebSocket): void {
    // 1. Get session from Map
    let session = this.sessions.get(sessionId);

    // If not found: auto-create session with default options
    if (!session) {
      // This is sync but create is async - we need to create synchronously
      // For now, we'll create a placeholder and handle the async creation
      // Actually, attach should not be async per the interface, so we need to rethink this
      // Looking at pseudocode: "Auto-create session with default options"
      // But we can't await in a sync function. We need to handle this differently.

      // Option: Make attach async (but interface says it's sync)
      // Option: Pre-create session synchronously without async handlers
      // Looking at the pseudocode more carefully, it says "auto-create" but the interface is sync

      // Let me check if there's a pattern in the codebase...
      // For now, I'll create a minimal session synchronously and set up async handlers

      try {
        // Create minimal session synchronously
        const shell = process.env.SHELL || '/bin/zsh';
        const cwd = process.cwd();

        if (!existsSync(shell)) {
          throw new Error(`Shell not found: ${shell}`);
        }

        const pty = Bun.spawn([shell], {
          cwd,
          env: process.env,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          pty: {
            cols: 80,
            rows: 24,
          },
        });

        session = {
          id: sessionId,
          pty,
          buffer: new RingBuffer(),
          websockets: new Set(),
          shell,
          cwd,
          createdAt: new Date(),
          lastActivity: new Date(),
        };

        // Set up async handlers in background
        const handleOutput = async (data: Buffer) => {
          const text = data.toString('utf8');
          session.buffer.write(text);
          session.lastActivity = new Date();

          for (const connectedWs of session.websockets) {
            try {
              connectedWs.send(JSON.stringify({ type: 'output', data: text }));
            } catch (error) {
              // WebSocket closed, ignore
            }
          }
        };

        const handleExit = async () => {
          session.lastActivity = new Date();

          for (const connectedWs of session.websockets) {
            try {
              connectedWs.send(JSON.stringify({ type: 'exit', code: -1 }));
            } catch (error) {
              // WebSocket closed, ignore
            }
          }

          this.sessions.delete(sessionId);
        };

        (async () => {
          for await (const chunk of pty.stdout) {
            await handleOutput(chunk);
          }
          await handleExit();
        })().catch((error) => {
          console.error(`PTY output handler error for session ${sessionId}:`, error);
        });

        this.sessions.set(sessionId, session);
      } catch (error) {
        console.error(`Failed to auto-create session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }

    // 2. Add ws to session.websockets Set
    session.websockets.add(ws);

    // 3. Replay buffer contents to this ws
    try {
      const bufferContents = session.buffer.getContents();
      if (bufferContents) {
        ws.send(JSON.stringify({ type: 'output', data: bufferContents }));
      }
    } catch (error) {
      console.warn(`Failed to replay buffer for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 4. Update session.lastActivity
    session.lastActivity = new Date();
  }

  /**
   * Detach a WebSocket (PTY continues running).
   */
  detach(sessionId: string, ws: ServerWebSocket): void {
    // 1. Get session from Map
    const session = this.sessions.get(sessionId);
    if (!session) {
      // No-op if session not found
      return;
    }

    // 2. Remove ws from session.websockets Set
    session.websockets.delete(ws);

    // 3. PTY continues running (no cleanup on detach)
  }

  /**
   * Kill a PTY session and cleanup.
   */
  kill(sessionId: string): void {
    // 1. Get session from Map
    const session = this.sessions.get(sessionId);
    if (!session) {
      // Already killed, no-op
      return;
    }

    // 2. Broadcast exit message to all websockets
    for (const ws of session.websockets) {
      try {
        ws.send(JSON.stringify({ type: 'exit', code: -1 }));
      } catch (error) {
        // WebSocket already closed, ignore
      }
    }

    // 3. Close all websockets in session.websockets
    for (const ws of session.websockets) {
      try {
        ws.close();
      } catch (error) {
        // Already closed, ignore
      }
    }

    // 4. Kill PTY process
    try {
      session.pty.kill();
    } catch (error) {
      // Already dead, ignore
    }

    // 5. Clear buffer
    session.buffer.clear();

    // 6. Remove session from Map
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
