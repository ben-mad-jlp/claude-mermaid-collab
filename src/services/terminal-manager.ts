import { join, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { TerminalSessionsState } from '../types/terminal.js';
import { sendTmuxKeysRaw } from './tmux-send.js';
import { mux } from './session-mux/index.js';

const rawExec = promisify(exec);
// Route every tmux shell-string through the SessionMux seam. Identity on the
// native backend (byte-parity — terminal-manager.test guards this); the WSL
// backend runs the command inside the distro. Every execAsync call here is a tmux
// command, so wrapping centrally covers them all (Windows port P1b).
const execAsync = (command: string) => rawExec(mux.shellWrap(command));

export class TerminalManager {
  /**
   * Get storage path for terminal sessions
   * Checks new location first (.collab/sessions/), then old location for backwards compatibility
   */
  private getStoragePath(project: string, session: string): string {
    // Check new location first
    const newPath = join(project, '.collab', 'sessions', session, 'terminal-sessions.json');
    if (existsSync(newPath) || existsSync(dirname(newPath))) {
      return newPath;
    }

    // Check old location for backwards compatibility
    const oldPath = join(project, '.collab', session, 'terminal-sessions.json');
    if (existsSync(oldPath) || existsSync(dirname(oldPath))) {
      return oldPath;
    }

    // Default to new location
    return newPath;
  }

  /**
   * Read terminal sessions from storage
   */
  async readSessions(project: string, session: string): Promise<TerminalSessionsState> {
    const storagePath = this.getStoragePath(project, session);

    try {
      if (!existsSync(storagePath)) {
        return { sessions: [], lastModified: new Date().toISOString() };
      }

      const content = readFileSync(storagePath, 'utf-8');
      return JSON.parse(content) as TerminalSessionsState;
    } catch (error) {
      console.warn(`Failed to read terminal sessions from ${storagePath}:`, error);
      return { sessions: [], lastModified: new Date().toISOString() };
    }
  }

  /**
   * Write terminal sessions to storage
   */
  async writeSessions(project: string, session: string, state: TerminalSessionsState): Promise<void> {
    const storagePath = this.getStoragePath(project, session);
    const dir = dirname(storagePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    state.lastModified = new Date().toISOString();
    writeFileSync(storagePath, JSON.stringify(state, null, 2));
  }

  /** Restore the good terminal mode on a live tmux session: mouse OFF (tmux stays
   *  transparent so the app owns the wheel and xterm owns drag-to-copy) +
   *  alternate-scroll off. Unsticks a terminal wedged into tmux-owns-the-mouse
   *  state (drag-select clears on release; wheel sends arrow keys). Best-effort;
   *  never throws. (verified 2026-06-10) */
  async resetTmuxModes(tmuxSessionName: string): Promise<void> {
    try { await execAsync(`tmux set-option -t ${tmuxSessionName} mouse off`); } catch { /* best-effort */ }
    try { await execAsync(`tmux set-option -wt ${tmuxSessionName} alternate-scroll off`); } catch { /* best-effort */ }
  }

  /**
   * Re-sync Claude Code's TUI mode by switching it to fullscreen. This is the
   * real cure for the "wedged terminal" symptom: Claude's TUI can get into a
   * confused state where it believes it's in one mode while its actual
   * alt-screen / mouse-reporting DECSET state is out of sync — chat history is
   * missing from the scrollback and the wheel sends arrow keys instead of
   * scrolling. Explicitly entering fullscreen forces Claude to emit a clean,
   * definitive mode transition (full enter-alt-screen + enable-mouse sequences +
   * repaint), which overwrites the inconsistent state and re-synchronizes
   * Claude's model with the terminal. (The user's verified `/tui fullscreen`
   * workaround, automated; they prefer to land IN fullscreen.)
   *
   * Best-effort; never throws. On a non-Claude pane it's harmless (a
   * "command not found" at the shell).
   */
  async resyncClaudeTui(tmuxSessionName: string): Promise<void> {
    try {
      await sendTmuxKeysRaw(tmuxSessionName, '/tui fullscreen');
    } catch { /* best-effort — never throw from the reset path */ }
  }

  /**
   * Kill tmux session via shell
   */
  async killTmuxSession(tmuxSessionName: string): Promise<void> {
    try {
      // Run tmux kill-session -t {tmuxSessionName}
      await execAsync(`tmux kill-session -t ${tmuxSessionName}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check if "no session" error (session doesn't exist)
      if (errorMsg.includes('no session') || errorMsg.includes('can\'t find session')) {
        // If not found: That's OK, already dead
        return;
      }

      // Otherwise: Throw error
      throw new Error(`Failed to kill tmux session ${tmuxSessionName}: ${errorMsg}`);
    }
  }

}

// Singleton instance
export const terminalManager = new TerminalManager();
