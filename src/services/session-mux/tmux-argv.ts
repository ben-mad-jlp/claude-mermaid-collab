/**
 * Pure tmux/ps argv builders — the single source of truth for every command word
 * the worker-session layer hands to `tmux` (or `ps`). Centralizing them here is
 * what makes the Windows port possible: a non-tmux backend (`WslTmuxSessionMux`)
 * transforms these argv arrays at exactly one seam (`TmuxSessionMux.transform`)
 * instead of chasing scattered `Bun.spawn(['tmux', …])` literals across 10 files.
 *
 * Each builder returns the FULL argv INCLUDING the leading `'tmux'`/`'ps'`, byte
 * -identical to the literal it replaced. The golden-argv parity test asserts this.
 * No I/O here — these are mechanically lifted argument lists, nothing more.
 */

/** tmux has-session -t <name> */
export function argvHasSession(name: string): string[] {
  return ['tmux', 'has-session', '-t', name];
}

/** tmux new-session -d -s <name> [-c <cwd>] */
export function argvNewSession(name: string, cwd?: string): string[] {
  return ['tmux', 'new-session', '-d', '-s', name, ...(cwd ? ['-c', cwd] : [])];
}

/** tmux kill-session -t <name> */
export function argvKillSession(name: string): string[] {
  return ['tmux', 'kill-session', '-t', name];
}

/** tmux capture-pane -t <name> -p [-S -<scrollback>] */
export function argvCapturePane(name: string, scrollback?: number): string[] {
  return ['tmux', 'capture-pane', '-t', name, '-p', ...(scrollback != null ? ['-S', `-${scrollback}`] : [])];
}

/** tmux list-panes -t <name> -F '#{pane_pid}' */
export function argvListPanesPanePid(name: string): string[] {
  return ['tmux', 'list-panes', '-t', name, '-F', '#{pane_pid}'];
}

/** tmux display-message -p -t <name> '#{pane_start_path}' */
export function argvDisplayStartPath(name: string): string[] {
  return ['tmux', 'display-message', '-p', '-t', name, '#{pane_start_path}'];
}

/** tmux send-keys -t <name> -l <text> (literal type, no key-name interpretation) */
export function argvSendKeysLiteral(name: string, text: string): string[] {
  return ['tmux', 'send-keys', '-t', name, '-l', text];
}

/** tmux send-keys -t <name> Enter (standalone submit) */
export function argvSendKeysEnter(name: string): string[] {
  return ['tmux', 'send-keys', '-t', name, 'Enter'];
}

/** tmux list-sessions -F <format> */
export function argvListSessions(format: string): string[] {
  return ['tmux', 'list-sessions', '-F', format];
}

/** tmux ls -F <format> (the `ls` alias the fleet/ide read-models use) */
export function argvLs(format: string): string[] {
  return ['tmux', 'ls', '-F', format];
}

/** tmux attach-session -d -t <name> */
export function argvAttachSession(name: string): string[] {
  return ['tmux', 'attach-session', '-d', '-t', name];
}

/** tmux -V (availability probe) */
export function argvVersion(): string[] {
  return ['tmux', '-V'];
}

/** ps -axo pid=,ppid=,comm= (coordinator-live / tmux-reaper subtree snapshot) */
export function argvPsComm(): string[] {
  return ['ps', '-axo', 'pid=,ppid=,comm='];
}

/** ps -axo pid=,ppid=,uid=,comm= (fleet-status snapshot — includes uid) */
export function argvPsUidComm(): string[] {
  return ['ps', '-axo', 'pid=,ppid=,uid=,comm='];
}
