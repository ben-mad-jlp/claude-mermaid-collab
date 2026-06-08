/**
 * Launches a Claude in the project dir (which MUST be trusted, else the trust
 * prompt swallows the /collab command), binds the session via /collab, and
 * optionally invokes a skill. Best-effort: returns a result object rather than
 * throwing.
 */
import { tmuxBaseName } from './tmux-naming.js';
import { sendTmuxKeysRaw } from './tmux-send.ts';
import { healStaleTmuxSession } from './tmux-session.ts';
import { registerLaneClaudeSession } from './lane-session-register.ts';
import { existsSync } from 'node:fs';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runtime-permission-mode → extra `claude` CLI flags. Mirrors
 *  child-manager.ts's runtimeModeToFlags (kept local so this lean spawn helper
 *  doesn't depend on the headless child-process manager). */
function runtimeModeFlags(mode?: 'read-only' | 'edit' | 'bypass'): string {
  switch (mode) {
    case 'read-only': return ' --disallowedTools "Edit,Write,MultiEdit,NotebookEdit,Bash"';
    case 'bypass': return ' --dangerously-skip-permissions';
    default: return '';
  }
}

/** Capture the tmux pane text for `tmux`; '' on any failure. */
function capturePane(tmux: string): string {
  try {
    const p = Bun.spawnSync(['tmux', 'capture-pane', '-t', tmux, '-p'], { stdout: 'pipe', stderr: 'ignore' });
    return p.stdout?.toString() ?? '';
  } catch { return ''; }
}

/** Kill a tmux session (best-effort). Used to tear down a bare-shell session that
 *  failed to bring up Claude, so a retry re-creates it cleanly. */
function killTmux(tmux: string): void {
  try { Bun.spawnSync(['tmux', 'kill-session', '-t', tmux], { stdout: 'ignore', stderr: 'ignore' }); } catch { /* best-effort */ }
}

// The status bar (e.g. "🧠 0% ctx |" / "← for agents") only renders once the
// TUI is interactive — a reliable "ready for input" marker. (The ❯ prompt and
// welcome box appear earlier, during load, so they're not used.)
const isTuiReady = (t: string) => /ctx\s*\||for agents/.test(t);
// Markers that `/collab` registered (capture-pane shows the collab/Vibe banner).
const isCollabBound = (t: string) => /collab|server health|Vibe|register/i.test(t);

/**
 * Idempotently ensure a tmux session exists with `claude` launched AND bound to
 * the collab session via `/collab`. If the session is ALREADY up, interactive,
 * and collab-bound, it is REUSED as-is (no relaunch, no double `/collab`).
 * This is everything EXCEPT sending the worker skill — see runTodoInSession.
 */
/** Single-quote a string for safe inclusion in a shell command sent as keystrokes
 *  (the contextPrompt can carry spaces, quotes, newlines). Wraps in single quotes
 *  and escapes embedded single quotes via the '\'' idiom. */
function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export async function ensureSession(opts: {
  project: string;
  session: string;
  allowedTools?: string;
  model?: string;
  runtimeMode?: 'read-only' | 'edit' | 'bypass';
  /** Domain context injected via `--append-system-prompt` so the worker starts
   *  warm (SEAM·collab: a per-project manifest declares this). */
  contextPrompt?: string;
  /** Working directory to launch the session in. Defaults to `project`. Under the
   *  worker-isolation model (DOGFOOD #5) this is the worker's git worktree, so its
   *  edits land on an isolated branch instead of the shared working tree. */
  cwd?: string;
  /** Launch with Claude Code's Remote Control (`--remote-control`) so this session
   *  is drivable from the Claude app. Requires the session to be logged into
   *  claude.ai (our launched sessions already are) — does NOT work with a bare
   *  ANTHROPIC_API_KEY. Used for the steward + per-project planners. */
  remoteControl?: boolean;
}): Promise<{ ready: boolean; tmux?: string; reason?: string }> {
  try {
    if (!existsSync(opts.project)) return { ready: false, reason: 'no-project-dir' };
    const launchCwd = opts.cwd ?? opts.project;
    if (!existsSync(launchCwd)) return { ready: false, reason: 'no-cwd-dir' };

    const tmux = tmuxBaseName(opts.project, opts.session);

    // Self-heal: a pre-fix session parked in the wrong dir would otherwise be
    // reused, launching claude against the wrong folder.
    await healStaleTmuxSession(tmux, launchCwd);

    // Ensure the tmux session exists (map any spawn failure → no-tmux). If it
    // already exists AND claude is interactive + collab-bound, reuse it.
    let alreadyExisted = false;
    try {
      const check = Bun.spawn(['tmux', 'has-session', '-t', tmux], { stdout: 'ignore', stderr: 'ignore' });
      alreadyExisted = (await check.exited) === 0;
      if (!alreadyExisted) {
        const create = Bun.spawn(['tmux', 'new-session', '-d', '-s', tmux, '-c', launchCwd], { stdout: 'ignore', stderr: 'ignore' });
        await create.exited;
      }
    } catch (e: any) {
      return { ready: false, reason: 'no-tmux' };
    }

    // Fast path: a warm pool session that's already interactive AND bound — do
    // NOT relaunch claude or re-send /collab (which would inject stray text).
    if (alreadyExisted) {
      const pane = capturePane(tmux);
      if (isTuiReady(pane) && isCollabBound(pane)) {
        return { ready: true, tmux };
      }
    }

    // Launch Claude.
    const cmd = 'claude'
      + (opts.remoteControl ? ' --remote-control' : '')
      + (opts.allowedTools ? ' --allowedTools "' + opts.allowedTools + '"' : '')
      + (opts.model ? ' --model ' + opts.model : '')
      + (opts.contextPrompt ? ' --append-system-prompt ' + shellSingleQuote(opts.contextPrompt) : '')
      + runtimeModeFlags(opts.runtimeMode);
    await sendTmuxKeysRaw(tmux, cmd);

    // Readiness: a fixed sleep (and even the SessionStart-hook session-id file,
    // which is written too early) sent /collab before the prompt was
    // interactive, so the keystrokes were lost. Instead poll the pane until the
    // status bar renders (Claude is interactive), then send /collab and VERIFY
    // it registered — retrying a couple times — since cold-start/MCP timing
    // varies.
    const waitForTui = async (secs: number): Promise<boolean> => {
      for (let i = 0; i < secs; i++) {
        await sleep(1000);
        if (isTuiReady(capturePane(tmux))) return true;
      }
      return false;
    };

    // VERIFY CLAUDE ACTUALLY STARTED (not a bare shell). If the TUI never paints —
    // bad `claude` cmd, crash, a trust/login prompt — relaunch once, then re-poll.
    // If it's still not interactive, this tmux is a bare shell: tear it down and
    // report failure so the coordinator never marks it busy / assigns it a todo.
    let tuiReady = await waitForTui(60);
    if (!tuiReady) {
      await sendTmuxKeysRaw(tmux, cmd); // one relaunch attempt
      tuiReady = await waitForTui(45);
    }
    if (!tuiReady) {
      killTmux(tmux);
      return { ready: false, reason: 'claude-not-interactive' };
    }
    await sleep(1500); // settle

    // Bind the collab session; resend if it didn't take.
    for (let attempt = 0; attempt < 3; attempt++) {
      await sendTmuxKeysRaw(tmux, '/collab ' + opts.session);
      await sleep(4000);
      if (isCollabBound(capturePane(tmux))) break;
    }

    // Deterministically register THIS lane's Claude session so it shows live
    // status (status dot + context%) in the UI like an interactive /collab
    // session. The worker skill never registers, and the auto-sent /collab
    // above stalls on the "create session?" prompt for pool lanes — so the
    // daemon does the binding itself from the pane's Claude PID. Best-effort:
    // a registration failure must not fail the spawn. (SEAM·collab option B.)
    try {
      await registerLaneClaudeSession({ project: opts.project, session: opts.session, tmux });
    } catch { /* observability nicety; never block the spawn */ }

    return { ready: true, tmux };
  } catch (e) {
    return { ready: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Send `invokeSkill` (e.g. `/mermaid-collab:worker <id>`) into an EXISTING
 * collab-bound tmux session. Assumes ensureSession already ran for this session
 * — this is the "run a todo in a warm session" primitive that lets a pool
 * session take a second todo without re-spawning.
 */
export async function runTodoInSession(opts: {
  session: string;
  invokeSkill: string;
  /** Optional explicit tmux name; defaults to deriving from project+session is
   *  not possible here (no project), so callers should pass the tmux returned
   *  by ensureSession. Falls back to opts.session if it's already a tmux name. */
  tmux?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const tmux = opts.tmux ?? opts.session;
    const check = Bun.spawn(['tmux', 'has-session', '-t', tmux], { stdout: 'ignore', stderr: 'ignore' });
    if ((await check.exited) !== 0) return { sent: false, reason: 'no-tmux' };

    await sleep(12000);
    // VERIFY CLAUDE IS INTERACTIVE before assigning the todo. A warm pool session
    // whose Claude died leaves a bare shell; sending the worker skill into it is
    // silently lost. Don't assign — report failure so the coordinator relaunches.
    if (!isTuiReady(capturePane(tmux))) return { sent: false, reason: 'claude-not-interactive' };
    await sendTmuxKeysRaw(tmux, opts.invokeSkill);
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Back-compat composer: ensureSession(...) then (if invokeSkill) run it.
 * Preserves the original `{ started, tmux?, bind?, reason? }` return shape so
 * existing callers are untouched.
 */
export async function launchAndBind(opts: {
  project: string;
  session: string;
  allowedTools?: string;
  invokeSkill?: string;
  model?: string;
  runtimeMode?: 'read-only' | 'edit' | 'bypass';
  remoteControl?: boolean;
}): Promise<{ started: boolean; tmux?: string; bind?: 'pending'; reason?: string }> {
  const ensured = await ensureSession({
    project: opts.project,
    session: opts.session,
    allowedTools: opts.allowedTools,
    model: opts.model,
    runtimeMode: opts.runtimeMode,
    remoteControl: opts.remoteControl,
  });
  if (!ensured.ready) return { started: false, reason: ensured.reason };

  if (opts.invokeSkill) {
    await runTodoInSession({ session: opts.session, invokeSkill: opts.invokeSkill, tmux: ensured.tmux });
  }

  return { started: true, tmux: ensured.tmux, bind: 'pending' };
}
