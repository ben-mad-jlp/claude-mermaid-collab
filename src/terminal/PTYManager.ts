import type { ServerWebSocket, Subprocess, Terminal } from 'bun';
import { RingBuffer } from './RingBuffer';
import { existsSync } from 'fs';
import { mux } from '../services/session-mux/index';

/** A tmux session a persistent PTY can be (re-)pointed at. `base` is the real
 *  session name; `grouped` is an optional shared/grouped view onto it. */
export interface TmuxTarget {
  base: string;
  grouped?: string;
}

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
  /** True for THE single persistent, re-pointable PTY (per server). Its process
   *  is a bare host shell that `switchTarget` drives between tmux sessions; it is
   *  never reaped on last detach (the connection outlives any one tmux target). */
  persistent: boolean;
  /** The tmux target currently attached inside this PTY, or null when the host
   *  shell is at its prompt (no target attached yet). Updated by `switchTarget`. */
  currentTmuxTarget: TmuxTarget | null;
  /** False until the shell has emitted its first output (its prompt). A freshly
   *  spawned interactive shell flushes its tty input on startup (tcflush), so a
   *  `tmux attach …` command written into stdin BEFORE that flush loses its
   *  leading bytes — the v5.92.23/24 regression (command arrived truncated to
   *  `|| tmux new-session …` → `syntax error near unexpected token 'tmux'`).
   *  switchTarget queues into `pendingWrite` while not ready; the first-data
   *  handler flushes it once the prompt proves the shell is reading. Sessions
   *  created via `create()` are treated as ready (their write path is covered by
   *  unit tests that expect a synchronous write). */
  ready: boolean;
  /** A switchTarget payload deferred until the shell is `ready` (first attach) or
   *  the previous tmux client has fully detached (a re-point). See switchTarget. */
  pendingWrite: string | null;
  /** True while a re-point is waiting for the OLD tmux client to finish detaching
   *  before the new attach command is written. Writing the attach the instant the
   *  detach key (C-b d) is sent loses its leading bytes: the still-attached client
   *  reads them in raw mode and discards them, so the shell receives a truncated
   *  `|| tmux new-session …` → broken switch (the v5.92.26 switch regression). The
   *  data handler clears this and flushes `pendingWrite` once tmux prints its
   *  `[detached …]` line, which only appears after the client is gone. */
  awaitingDetach: boolean;
}

export interface PTYSessionInfo {
  id: string;
  shell: string;
  cwd: string;
  createdAt: Date;
  lastActivity: Date;
  connectedClients: number;
  persistent: boolean;
  currentTmuxTarget: TmuxTarget | null;
}

export interface CreateOptions {
  shell?: string;      // Default: $SHELL or fallback chain
  cwd?: string;        // Default: process.cwd()
  cols?: number;       // Default: 80
  rows?: number;       // Default: 24
  tmux?: { base: string; grouped?: string };
  /** Create THE persistent, re-pointable PTY: a bare host shell (no tmux attach
   *  at spawn) that `switchTarget` later points at tmux sessions. Mutually
   *  exclusive with an initial `tmux` attach — when set, `tmux` is ignored and
   *  the target is selected later via `switchTarget`. */
  persistent?: boolean;
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
    return mux.shellWrap(`${ensureBase} ; ${styleStatus(base)} ; tmux attach-session -d -t '${base}'`);
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
  return mux.shellWrap(`${ensureBase} ; ${ensureGrouped} ; ${styleStatus(grouped)} ; tmux attach-session -d -t '${grouped}'`);
}

/** Detach sequence written to the persistent host shell before re-attaching to
 *  a new tmux target: tmux's default prefix (C-b, 0x02) then `d`. This detaches
 *  the live `tmux attach` foreground process, returning control to the host
 *  shell so the next `tmux attach-session` can run in the SAME PTY — the fd, the
 *  process, and every attached WebSocket survive the switch. (The session style
 *  applied on attach never remaps the prefix, so C-b is safe.) */
export const TMUX_DETACH_SEQUENCE = '\x02d';

/** Tty line-kill (Ctrl-U, VKILL) prepended to every attach command. If a prior
 *  detach key (`\x02d`) was sent to a shell that turned out NOT to be attached to
 *  tmux (a stale `currentTmuxTarget` after a failed attach), the un-consumed
 *  `^Bd` sits in the shell's canonical line buffer; flushing the attach onto the
 *  same line produced `^Bd(tmux …)` → `/bin/sh: Syntax error` and a stuck loop.
 *  Leading the command with VKILL clears any such stray bytes; it's a no-op at a
 *  clean prompt. */
export const TMUX_LINE_KILL = '\x15';

/** Fallback delay before flushing a queued re-point attach if tmux's `[detached
 *  …]` line is never observed (e.g. an unusual detach path). Long enough that the
 *  normal detach (tens of ms) always wins via the marker; short enough to stay
 *  responsive if the marker is missed. */
export const DETACH_FLUSH_FALLBACK_MS = 500;

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
   * Determine the CONTROL shell for the persistent re-pointable console PTY.
   *
   * This PTY is never a place the user types directly — `switchTarget` writes
   * `tmux attach-session …` commands into its stdin and tmux owns the screen from
   * there. It MUST be a quiet POSIX shell (`/bin/sh`), NOT the user's interactive
   * `$SHELL`: an interactive zsh (p10k / ZLE / bracketed-paste / autosuggest)
   * mangles a multi-line command written as a burst into its line editor, which
   * is exactly the v5.92.23 regression — the attach command echoed back as
   * literal text and zsh died with `parse error near ')'`. `/bin/sh` runs the
   * written command verbatim. The interactive `$SHELL` still runs *inside* every
   * tmux pane via tmux's own default-command — the user never loses their shell.
   */
  private getControlShell(): string {
    const candidates = ['/bin/sh', '/bin/bash', '/bin/zsh'];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    // Last resort: whatever getShell resolves (keeps the old behaviour rather
    // than throwing if a host somehow lacks /bin/sh).
    return this.getShell();
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

    // A persistent PTY is a bare host shell — it ignores any initial `tmux`
    // attach so `switchTarget` is the single path that points it at a target.
    const persistent = !!options?.persistent;
    const attachTmuxAtSpawn = !!options?.tmux && !persistent;

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
      isTmux: attachTmuxAtSpawn,
      persistent,
      currentTmuxTarget: attachTmuxAtSpawn
        ? { base: options!.tmux!.base, grouped: options!.tmux!.grouped }
        : null,
      // create()-made sessions write synchronously (covered by unit tests).
      ready: true,
      pendingWrite: null,
      awaitingDetach: false,
    };

    try {
      let proc: ReturnType<typeof Bun.spawn>;

      if (attachTmuxAtSpawn) {
        // Spawn via tmux grouping
        const { base, grouped } = options!.tmux!;
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

    return this.toInfo(session);
  }

  /** Project a PTYSession into its public info shape. */
  private toInfo(session: PTYSession): PTYSessionInfo {
    return {
      id: session.id,
      shell: session.shell,
      cwd: session.cwd,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      connectedClients: session.websockets.size,
      persistent: session.persistent,
      currentTmuxTarget: session.currentTmuxTarget,
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
   * Re-point a persistent PTY at a new tmux target WITHOUT tearing down the
   * connection. This is the foundation the per-server console builds on: the
   * PTY id (and therefore every attached WebSocket, the process, and the fd)
   * is stable; only the tmux session running inside it changes.
   *
   * Mechanics: if a target is already attached, send the tmux detach sequence
   * to drop the live attach back to the host shell prompt, then write a fresh
   * `tmux attach-session` for the new target into that same shell.
   *
   * Clean redraw (the correctness-critical piece this leaf adds): the attach is
   * chained with `tmux refresh-client -S` so tmux's NATIVE client-attach redraw
   * repaints the pane's true alt-screen / mouse / scroll state, and the
   * server-side RingBuffer is CLEARED — we deliberately SKIP the byte-replay that
   * desynced a running TUI (the /tui wedge): replaying captured raw bytes (stale
   * alt-screen enter/exit, cursor moves from the prior target) painted on top of
   * tmux's redraw and corrupted the screen (arrow-key/desync). tmux owns the
   * repaint now; the buffer only serves a future bare-shell reconnect.
   *
   * Finally, broadcast a `switched` ack so each client can react.
   *
   * @throws if the session does not exist.
   */
  /** Write a session's queued switchTarget payload (if any) to its PTY and clear
   *  the pending/awaiting state. Idempotent: a no-op once already flushed, so the
   *  data-handler marker and the timer fallback can both call it safely. */
  private flushPending(session: PTYSession): void {
    if (!session.pendingWrite) {
      session.awaitingDetach = false;
      return;
    }
    const queued = session.pendingWrite;
    session.pendingWrite = null;
    session.awaitingDetach = false;
    try {
      session.terminal.write(queued);
    } catch (error) {
      console.warn(`Failed to flush queued switch for ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  switchTarget(sessionId: string, tmux: { base: string; grouped?: string; cwd?: string }): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const { base, grouped, cwd } = tmux;
    const attachCmd = buildTmuxAttachCommand(base, grouped, cwd ?? session.cwd);
    // Chain a forced full redraw onto the attach. `tmux attach-session ... \;
    // refresh-client -S` runs both as one tmux client invocation: the attach
    // establishes the client (which natively redraws), then refresh-client -S
    // re-syncs its size and forces the pane to repaint cleanly. This replaces
    // the server-side RingBuffer replay that desynced the TUI.
    const attachPayload = `${TMUX_LINE_KILL}${attachCmd} \\; refresh-client -S\n`;

    try {
      if (!session.ready) {
        // Shell still initializing — DON'T write yet, or its startup input-flush
        // eats the command's leading bytes (truncation → `syntax error near
        // 'tmux'`). Queue it; the first-data handler flushes once the prompt
        // proves the shell is reading. No detach needed: nothing is attached yet.
        session.pendingWrite = attachPayload;
        session.awaitingDetach = false;
      } else if (session.currentTmuxTarget) {
        // RE-POINT: a tmux client currently owns the shell's stdin. Send the
        // detach key, but DON'T write the attach command yet — the detaching
        // client reads ahead in raw mode and would swallow its leading bytes
        // (the truncated `|| tmux new-session …` switch bug). Queue it; the data
        // handler flushes once tmux prints `[detached …]` (client fully gone).
        // A timer is the fallback in case that line never arrives.
        session.pendingWrite = attachPayload;
        session.awaitingDetach = true;
        session.terminal.write(TMUX_DETACH_SEQUENCE);
        setTimeout(() => {
          if (this.sessions.get(sessionId) === session) this.flushPending(session);
        }, DETACH_FLUSH_FALLBACK_MS);
      } else {
        // Ready shell, no current target → safe to write immediately.
        session.terminal.write(attachPayload);
      }
    } catch (error) {
      console.warn(`Failed to switch target for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Drop output captured under the PREVIOUS target so a later reconnect's
    // attach() replay can't paint stale cross-target bytes over the freshly
    // tmux-redrawn screen. We rely on tmux's attach redraw, not byte-replay.
    session.buffer.clear();

    session.currentTmuxTarget = { base, grouped };
    session.lastActivity = new Date();

    // Ack the switch to every attached client.
    const ack = JSON.stringify({ type: 'switched', target: { base, grouped } });
    for (const ws of session.websockets) {
      try {
        ws.send(ack);
      } catch (error) {
        // WebSocket may have been closed, ignore
      }
    }
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
      // The auto-created session IS the persistent re-pointable console: tmux
      // attach commands are written into its stdin by switchTarget, never typed
      // by a human. Use a quiet control shell (/bin/sh), NOT the user's
      // interactive $SHELL — see getControlShell() for why (v5.92.23 regression).
      const shell = this.getControlShell();
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
        persistent: false,
        currentTmuxTarget: null,
        // The console shell starts NOT ready: switchTarget's attach command must
        // wait for the first prompt or the shell's startup tcflush eats its
        // leading bytes (the truncation regression). Flipped on first data below.
        ready: false,
        pendingWrite: null,
        awaitingDetach: false,
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
              // Flush a queued switchTarget command at the right moment:
              //  - first attach: the shell's first output is its prompt → it has
              //    finished initializing (past its startup input-flush) and is
              //    reading stdin, so the command lands intact.
              //  - re-point: wait for tmux's `[detached …]` line, which only prints
              //    once the OLD client is fully gone — writing sooner lets the
              //    detaching client swallow the new command's leading bytes.
              const firstData = !session!.ready;
              session!.ready = true;
              if (session!.pendingWrite) {
                const detachDone = session!.awaitingDetach && text.includes('detached');
                if (detachDone || (firstData && !session!.awaitingDetach)) {
                  this.flushPending(session!);
                }
              }
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
    // reconnects, so they are never reaped here. A persistent re-pointable PTY
    // also survives last-detach — its host shell outlives any one tmux target,
    // so a reconnect can re-point it rather than re-spawn.
    if (session.isTmux && !session.persistent && session.websockets.size === 0) {
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
      result.push(this.toInfo(session));
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

    return this.toInfo(session);
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
