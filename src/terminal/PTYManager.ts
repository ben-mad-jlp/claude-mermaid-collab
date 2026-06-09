import type { ServerWebSocket, Subprocess, Terminal } from 'bun';
import { RingBuffer } from './RingBuffer';
import { existsSync } from 'fs';

export interface PTYSession {
  id: string;
  process: Subprocess<'ignore', 'ignore', 'ignore'>;
  terminal: Terminal;
  buffer: RingBuffer;
  websockets: Set<ServerWebSocket<any>>;
  shell: string;
  cwd: string;
  createdAt: Date;
  lastActivity: Date;
  hasReceivedResize: boolean;
  deferReplay: boolean;
  /** True when this PTY is a `tmux attach-session` (vs a bare interactive shell).
   *  A tmux attach is disposable — detaching it leaves the underlying tmux
   *  session (and its scrollback) intact — so it is safe to reap on last client
   *  disconnect. A bare shell IS the session, so it must persist across reconnects. */
  isTmux: boolean;
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
  tmux?: { base: string; grouped?: string };
}

/**
 * Build the shell command that attaches a PTY to a tmux *grouped* session
 * (mirroring the VSCodium extension so the desktop app and the IDE share live
 * sessions). The base session must exist before the grouped session can target
 * it, so it is created first (with `;` so creation failure of an existing base
 * doesn't abort the chain). Exported for unit testing.
 *
 * `cwd` (when given) is passed to `new-session -c` so the session's panes start
 * in the project directory — otherwise tmux inherits the *server* process's cwd
 * (e.g. the app's Resources dir), and `claude`/`git` would run against the wrong
 * folder. It only affects session *creation*; attaching to an existing session
 * keeps that session's directory.
 */
export function buildTmuxAttachCommand(base: string, grouped?: string, cwd?: string): string {
  // `-d` detaches any other client on the session: a tmux window has a single
  // size, so co-attached clients of different sizes fight under
  // `window-size latest` — every stream/redraw can snap the window to the other
  // client's size and garble a full-screen TUI (e.g. Claude Code). One client
  // owning the window keeps it stable.
  const dirFlag = cwd ? ` -c '${cwd.replace(/'/g, `'\\''`)}'` : '';
  const ensureBase = `(tmux has-session -t '${base}' 2>/dev/null || tmux new-session -d -s '${base}'${dirFlag})`;
  // Show the FULL session name in the bottom status bar. tmux's default
  // status-left is `[#S] ` but status-left-length defaults to 10, so a long
  // `mc-{project}-{lane}` name gets truncated to noise. Widen it + render the
  // session name explicitly so you can always tell which lane a pane is. Scoped
  // to this session (not global), idempotent, applied on every attach.
  const styleStatus = (sess: string) =>
    `tmux set-option -t '${sess}' status on \\; ` +
    `set-option -t '${sess}' status-left-length 80 \\; ` +
    `set-option -t '${sess}' status-left '#[bg=colour24,fg=white,bold] #S #[default] '`;
  if (!grouped || grouped === base) {
    // Attach directly to the base session — no shared/grouped view. (The old
    // grouped 'vscode-collab-*' layer existed to share live terminals with the
    // VSCode extension, which no longer hosts terminals.)
    return `${ensureBase} ; ${styleStatus(base)} ; tmux attach-session -d -t '${base}'`;
  }
  // Stale-group guard (the GROUPED analog of healStaleTmuxSession's base heal).
  // A grouped session is created ONCE and reused on every later click via
  // has-session. But grouping binds to a session *object*, not its name: when a
  // worker dies and a NEW base takes the same name (`mc-<repo>-<lane>`), the old
  // `vscode-collab-<base>` survives in the OLD (now-orphaned) group — pointing at
  // the previous worker's window, not the live base. has-session still sees it, so
  // it's reused, and the user attaches to a dead window ("[process exited: 0]").
  // Detect this by comparing `#{session_group}`: tmux assigns the same group name
  // to grouped+base while they're grouped together, but a freshly recreated
  // standalone base has an empty/different group. Reuse ONLY when the groups match;
  // otherwise kill the stale grouped session and recreate it against the live base.
  // A still-current grouped session matches and is reused unchanged.
  const groupOf = (sess: string) => `"$(tmux display-message -p -t '${sess}' '#{session_group}' 2>/dev/null)"`;
  const ensureGrouped =
    `(tmux has-session -t '${grouped}' 2>/dev/null && [ ${groupOf(base)} = ${groupOf(grouped)} ] ` +
    `|| { tmux kill-session -t '${grouped}' 2>/dev/null ; tmux new-session -d -s '${grouped}' -t '${base}' ; })`;
  return `${ensureBase} ; ${ensureGrouped} ; ${styleStatus(grouped)} ; tmux attach-session -d -t '${grouped}'`;
}

export interface AttachOptions {
  cols?: number;
  rows?: number;
  deferReplay?: boolean;  // If true, don't replay buffer until resize received
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
      hasReceivedResize: false,
      deferReplay: false,
      isTmux: !!options?.tmux,
    };

    try {
      let proc: ReturnType<typeof Bun.spawn>;

      if (options?.tmux) {
        // Spawn via tmux grouping
        const { base, grouped } = options.tmux;
        const tmuxCmd = buildTmuxAttachCommand(base, grouped, cwd);
        session.shell = '/bin/sh';
        proc = Bun.spawn(['/bin/sh', '-c', tmuxCmd], {
          cwd,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
          },
          terminal: {
            cols,
            rows,
            data: (terminal, data) => {
              const text = new TextDecoder().decode(data);
              session.buffer.write(text);
              session.lastActivity = new Date();

              for (const ws of session.websockets) {
                try {
                  if (session.hasReceivedResize || !session.deferReplay) {
                    ws.send(JSON.stringify({ type: 'output', data: text }));
                  }
                } catch (error) {
                  // WebSocket may have been closed, ignore
                }
              }
            },
            exit: (terminal, exitCode, signal) => {
              console.log(`PTY session ${sessionId} exited: code=${exitCode}, signal=${signal}`);
              session.lastActivity = new Date();

              for (const ws of session.websockets) {
                try {
                  ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
                } catch (error) {
                  // WebSocket already closed, ignore
                }
              }

              this.sessions.delete(sessionId);
            },
          },
        });
      } else {
      // Spawn shell with Bun's native terminal option (callback-based API)
      proc = Bun.spawn([shell], {
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
            // Only send if we've received initial resize OR if not deferring replay
            for (const ws of session.websockets) {
              try {
                if (session.hasReceivedResize || !session.deferReplay) {
                  ws.send(JSON.stringify({ type: 'output', data: text }));
                }
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
      }

      session.process = proc as unknown as Subprocess<'ignore', 'ignore', 'ignore'>;
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
   * Resize PTY and mark session as having received resize.
   */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      session.terminal.resize(cols, rows);
    } catch (error) {
      console.warn(`Failed to resize session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Track if this was the first resize (for deferred replay)
    const wasFirst = !session.hasReceivedResize;
    session.hasReceivedResize = true;

    // If this was the first resize and we were deferring, replay now
    if (wasFirst && session.deferReplay && session.websockets.size > 0) {
      for (const ws of session.websockets) {
        this.replayBuffer(sessionId, ws);
      }
    }

    session.lastActivity = new Date();
  }

  /**
   * Attach a WebSocket to receive output and replay buffer.
   * Auto-creates session if it doesn't exist.
   * @param sessionId - Terminal session ID
   * @param ws - WebSocket connection
   * @param options - Attach options including deferReplay
   */
  attach(sessionId: string, ws: ServerWebSocket<any>, options?: AttachOptions): void {
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
        hasReceivedResize: false,
        deferReplay: false,
        isTmux: false,
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

              // Only send if we've received initial resize OR if not deferring replay
              for (const connectedWs of session!.websockets) {
                try {
                  if (session!.hasReceivedResize || !session!.deferReplay) {
                    connectedWs.send(JSON.stringify({ type: 'output', data: text }));
                  }
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

        session.process = proc as unknown as Subprocess<'ignore', 'ignore', 'ignore'>;
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

    // Store defer flag
    session.deferReplay = options?.deferReplay ?? false;
    session.hasReceivedResize = false;

    // Replay buffer contents to this ws only if NOT deferring
    if (!session.deferReplay) {
      try {
        const bufferContents = session.buffer.getContents();
        if (bufferContents) {
          ws.send(JSON.stringify({ type: 'output', data: bufferContents }));
        }
      } catch (error) {
        console.warn(`Failed to replay buffer for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    session.lastActivity = new Date();
  }

  /**
   * Replay buffered output to WebSocket.
   * Called after first resize when deferReplay was true.
   */
  replayBuffer(sessionId: string, ws: ServerWebSocket<any>): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Send all buffered output
    try {
      const bufferContents = session.buffer.getContents();
      if (bufferContents) {
        ws.send(JSON.stringify({ type: 'output', data: bufferContents }));
      }
    } catch (error) {
      console.warn(`Failed to replay buffer for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Detach a WebSocket (PTY continues running).
   */
  detach(sessionId: string, ws: ServerWebSocket<any>): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.websockets.delete(ws);

    // Reap tmux-attach PTYs once the last client disconnects. Every "create
    // terminal" mints a fresh UUID session + a new `tmux attach` PTY; without
    // this, detach only drops the websocket and the attach process lingers in
    // the Map forever — so each worker-card click leaked a PTY (connects with
    // no matching closes). Killing the attach detaches from, but does NOT kill,
    // the underlying tmux session, so its scrollback survives for the next
    // attach. Bare (non-tmux) shells ARE the session and must persist across
    // reconnects, so they are never reaped here.
    if (session.isTmux && session.websockets.size === 0) {
      this.kill(sessionId);
    }
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
