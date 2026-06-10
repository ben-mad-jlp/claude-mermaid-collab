import { join, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { TerminalSession, TerminalSessionsState } from '../types/terminal.js';

const execAsync = promisify(exec);

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

  /**
   * Generate unique tmux session name
   */
  generateTmuxSessionName(collabSession: string): string {
    // 1. Extract session name from collabSession:
    //    - Split by ':' or '/'
    //    - Take last segment
    //    - Default to 'default' if empty
    let sessionName = collabSession;

    // Split by ':' or '/' and take the last part
    const parts = collabSession.split(/[:\/]/);
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      if (lastPart) {
        sessionName = lastPart;
      } else {
        sessionName = 'default';
      }
    }

    if (!sessionName || sessionName.trim() === '') {
      sessionName = 'default';
    }

    // 2. Sanitize for tmux:
    //    - Replace non-alphanumeric to remove all non-alphanumeric chars (including hyphens)
    //    - Truncate to reasonable length (20 chars)
    const sanitized = sessionName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 20);

    // 3. Generate random suffix:
    //    - 4 chars: Math.random().toString(36).substr(2, 4)
    const randomSuffix = Math.random().toString(36).substring(2, 6);

    // 4. Return 'mc-' + sanitized + '-' + random
    //    - Example: 'mc-openboldmeadow-a1b2'
    const result = `mc-${sanitized || 'default'}-${randomSuffix}`;
    return result;
  }

  /**
   * Create tmux session via shell
   */
  async createTmuxSession(tmuxSessionName: string, cwd?: string): Promise<void> {
    try {
      // Run tmux new-session -d -s {tmuxSessionName} [-c {cwd}]
      if (cwd) {
        await execAsync(`tmux new-session -d -s ${tmuxSessionName} -c ${cwd}`);
      } else {
        await execAsync(`tmux new-session -d -s ${tmuxSessionName}`);
      }

      // Keep tmux's mouse OFF so tmux stays transparent to the mouse: the inner
      // app (Claude Code's TUI) owns the wheel (its own scrollback) and xterm.js
      // owns drag-to-select/copy. Turning `mouse on` makes tmux capture the mouse
      // at its own layer — which (a) hijacks drag into tmux copy-mode (selection
      // clears on mouse-up, breaking copy) and (b) with the default
      // `alternate-scroll on` translates the wheel into ↑/↓ arrow keys for
      // alternate-screen apps that aren't grabbing the mouse. Both bugs are
      // structurally impossible while mouse is off. (verified 2026-06-10)
      await execAsync(`tmux set-option -t ${tmuxSessionName} mouse off`);
      // Belt-and-suspenders: even if mouse is ever toggled on, never translate
      // the wheel into arrow keys. alternate-scroll is a WINDOW option (needs -w)
      // and may not exist on older tmux — best-effort so it never aborts creation.
      try {
        await execAsync(`tmux set-option -wt ${tmuxSessionName} alternate-scroll off`);
      } catch { /* unsupported tmux — not critical */ }

      // Disable terminal splitting by unbinding split keys
      // Unbind horizontal split (Ctrl+B %)
      try {
        await execAsync(`tmux unbind-key -t ${tmuxSessionName} %`);
      } catch (unbindError) {
        // If unbind fails, it's not critical - the session is still created
        // Log and continue
      }
      // Unbind vertical split (Ctrl+B ")
      try {
        await execAsync(`tmux unbind-key -t ${tmuxSessionName} '"'`);
      } catch (unbindError) {
        // If unbind fails, it's not critical - the session is still created
        // Log and continue
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check if session already exists (exit code 1 with "duplicate session")
      if (errorMsg.includes('duplicate session') || errorMsg.includes('already exists')) {
        // If duplicate: That's OK, session exists - still assert mouse-off mode and attempt unbind keys
        await execAsync(`tmux set-option -t ${tmuxSessionName} mouse off`);
        try {
          await execAsync(`tmux set-option -wt ${tmuxSessionName} alternate-scroll off`);
        } catch { /* unsupported tmux — not critical */ }
        try {
          await execAsync(`tmux unbind-key -t ${tmuxSessionName} %`);
        } catch {
          // Not critical if unbind fails
        }
        try {
          await execAsync(`tmux unbind-key -t ${tmuxSessionName} '"'`);
        } catch {
          // Not critical if unbind fails
        }
        return;
      }

      // Otherwise: Throw error
      throw new Error(`Failed to create tmux session ${tmuxSessionName}: ${errorMsg}`);
    }
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

  /**
   * List active tmux sessions matching prefix
   */
  async listActiveTmuxSessions(prefix: string): Promise<string[]> {
    try {
      // Run tmux list-sessions -F "#{session_name}" 2>/dev/null
      const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null');

      // Parse output:
      // - Split by newlines
      // - Filter to sessions starting with prefix
      // - Return filtered list
      const sessions = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && line.startsWith(prefix));

      return sessions;
    } catch (error) {
      // No tmux server: Return empty array
      return [];
    }
  }

  /**
   * Reconcile stored sessions with actual tmux sessions
   */
  async reconcileSessions(project: string, session: string): Promise<void> {
    // 1. Read stored sessions from file
    const state = await this.readSessions(project, session);

    // 2. Get active tmux sessions with prefix 'mc-{session}-'
    const prefix = `mc-${session}-`;
    const activeSessions = await this.listActiveTmuxSessions(prefix);

    // 3. For each stored session:
    //    - If tmuxSession NOT in active list:
    //      - Mark for removal (orphan in storage)
    const orphanedStoredSessions: string[] = [];
    for (const storedSession of state.sessions) {
      if (!activeSessions.includes(storedSession.tmuxSession)) {
        orphanedStoredSessions.push(storedSession.id);
      }
    }

    // 4. For each active tmux session:
    //    - If NOT in stored sessions:
    //      - Kill it (orphan in tmux)
    const storedTmuxNames = state.sessions.map(s => s.tmuxSession);
    for (const activeSession of activeSessions) {
      if (!storedTmuxNames.includes(activeSession)) {
        try {
          await this.killTmuxSession(activeSession);
        } catch (error) {
          console.warn(`Failed to kill orphan tmux session ${activeSession}:`, error);
        }
      }
    }

    // 5. Remove orphaned entries from stored sessions
    const removedCount = orphanedStoredSessions.length;
    state.sessions = state.sessions.filter(s => !orphanedStoredSessions.includes(s.id));

    // 6. Write updated state to file
    await this.writeSessions(project, session, state);

    // 7. Log reconciliation summary:
    //    - "Reconciled: removed N orphan records, killed M orphan tmux sessions"
    const killedCount = activeSessions.filter(a => !storedTmuxNames.includes(a)).length;
    console.log(`Reconciled: removed ${removedCount} orphan records, killed ${killedCount} orphan tmux sessions`);
  }
}

// Singleton instance
export const terminalManager = new TerminalManager();
