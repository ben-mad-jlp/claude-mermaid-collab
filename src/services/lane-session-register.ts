/**
 * Deterministic Claude-session registration for Coordinator-spawned worker lanes.
 *
 * The interactive `/collab` skill binds a session by discovering its own
 * `$PPID` and calling `register_claude_session`. Coordinator-spawned workers
 * never run that step (their auto-sent `/collab <session>` stalls on the
 * "session doesn't exist — create it?" prompt), so they run "dark": no per-lane
 * status dot / context% / notification binding in the UI. This module lets the
 * daemon do the binding itself at spawn time — it already owns the tmux pane and
 * knows the (project, session), so it can resolve the pane's Claude PID and
 * register it without relying on the worker LLM. (SEAM·collab; fix option B.)
 *
 * The binding it produces is byte-identical to what the `register_claude_session`
 * MCP handler writes: `/tmp/.mermaid-collab-binding-<claudeSessionId>.json` plus
 * an in-memory pid→session map and a POST to `/api/claude-session/register`.
 */
import * as fs from 'node:fs';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const API_PORT = parseInt(process.env.PORT || '9002', 10);
const API_HOST = process.env.HOST || 'localhost';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

/** Injectable seams so the resolution/registration logic is unit-testable
 *  without a real tmux pane, process tree, /tmp files, or HTTP server. */
export interface LaneRegisterDeps {
  /** PID of the shell running in the tmux pane (`tmux list-panes -F '#{pane_pid}'`). */
  panePid: (tmux: string) => number | null;
  /** Direct child PIDs of `pid` (`pgrep -P <pid>`). */
  childPids: (pid: number) => number[];
  /** The Claude session UUID the SessionStart hook wrote for `pid`, or null. */
  sessionIdForPid: (pid: number) => string | null;
  /** Persist the binding file + in-memory pid→session map. */
  writeBinding: (claudeSessionId: string, payload: object) => void;
  registerPid: (pid: number, session: string) => void;
  /** Notify the server so it broadcasts and starts watching. Returns ok. */
  postRegister: (project: string, session: string, claudeSessionId: string) => Promise<boolean>;
}

function defaultPanePid(tmux: string): number | null {
  try {
    const p = Bun.spawnSync(['tmux', 'list-panes', '-t', tmux, '-F', '#{pane_pid}'], { stdout: 'pipe', stderr: 'ignore' });
    const first = (p.stdout?.toString() ?? '').split('\n').map((l) => l.trim()).filter(Boolean)[0];
    const pid = Number(first);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

function defaultChildPids(pid: number): number[] {
  try {
    const p = Bun.spawnSync(['pgrep', '-P', String(pid)], { stdout: 'pipe', stderr: 'ignore' });
    return (p.stdout?.toString() ?? '')
      .split('\n').map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0);
  } catch { return []; }
}

function defaultSessionIdForPid(pid: number): string | null {
  try {
    const id = fs.readFileSync(`/tmp/.claude-session-id-${pid}`, 'utf-8').trim();
    return UUID_RE.test(id) ? id : null;
  } catch { return null; }
}

function defaultWriteBinding(claudeSessionId: string, payload: object): void {
  const file = `/tmp/.mermaid-collab-binding-${claudeSessionId}.json`;
  const content = JSON.stringify(payload, null, 2);
  try {
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, content, 'utf-8');
    try { fs.renameSync(tmp, file); } catch { fs.writeFileSync(file, content, 'utf-8'); }
  } catch { /* in-memory registration still covers the common case */ }
}

function defaultRegisterPid(pid: number, session: string): void {
  // Lazy import to avoid a static cycle and keep this module light at load.
  import('./cdp-session.js').then((m) => m.registerPidSession(pid, session)).catch(() => {});
}

async function defaultPostRegister(project: string, session: string, claudeSessionId: string): Promise<boolean> {
  try {
    const url = new URL('/api/claude-session/register', API_BASE_URL);
    url.searchParams.set('project', project);
    url.searchParams.set('session', session);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claudeSessionId }),
    });
    return res.ok;
  } catch { return false; }
}

const realDeps: LaneRegisterDeps = {
  panePid: defaultPanePid,
  childPids: defaultChildPids,
  sessionIdForPid: defaultSessionIdForPid,
  writeBinding: defaultWriteBinding,
  registerPid: defaultRegisterPid,
  postRegister: defaultPostRegister,
};

/**
 * Resolve the Claude CLI PID running inside `tmux`. The pane PID is the shell;
 * the Claude process is a descendant whose SessionStart hook wrote a
 * `/tmp/.claude-session-id-<pid>` file. We BFS the pane's process subtree and
 * return the first PID that has a valid session-id file — this both identifies
 * the Claude process AND confirms its binding file exists, with no reliance on
 * the process command name. Returns `{ pid, claudeSessionId }` or null.
 */
export function resolveLaneClaudeSession(
  tmux: string,
  deps: LaneRegisterDeps = realDeps,
): { pid: number; claudeSessionId: string } | null {
  const root = deps.panePid(tmux);
  if (root == null) return null;
  // BFS the subtree (bounded) so we find Claude even under an intermediate
  // wrapper process, without walking the whole system.
  const seen = new Set<number>();
  const queue: number[] = [root];
  let guard = 0;
  while (queue.length > 0 && guard < 256) {
    guard++;
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const id = deps.sessionIdForPid(pid);
    if (id) return { pid, claudeSessionId: id };
    for (const child of deps.childPids(pid)) if (!seen.has(child)) queue.push(child);
  }
  return null;
}

/**
 * Best-effort: bind a Coordinator-spawned worker lane's Claude session to the
 * collab server so it shows live status in the UI. Never throws — registration
 * is a UI/observability nicety, not a spawn prerequisite. Returns whether the
 * binding was established.
 */
export async function registerLaneClaudeSession(
  opts: { project: string; session: string; tmux: string },
  deps: LaneRegisterDeps = realDeps,
): Promise<{ registered: boolean; reason?: string }> {
  try {
    const resolved = resolveLaneClaudeSession(opts.tmux, deps);
    if (!resolved) return { registered: false, reason: 'no-claude-session-id' };
    const { pid, claudeSessionId } = resolved;

    deps.writeBinding(claudeSessionId, {
      claudeSessionId,
      project: opts.project,
      session: opts.session,
      claudePid: String(pid),
      boundAt: new Date().toISOString(),
    });
    deps.registerPid(pid, opts.session);
    const ok = await deps.postRegister(opts.project, opts.session, claudeSessionId);
    return { registered: ok, reason: ok ? undefined : 'api-post-failed' };
  } catch (e) {
    return { registered: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
