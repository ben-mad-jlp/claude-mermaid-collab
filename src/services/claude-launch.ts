/**
 * Launches a Claude in the project dir (which MUST be trusted, else the trust
 * prompt swallows the /collab command), binds the session via /collab, and
 * optionally invokes a skill. Best-effort: returns a result object rather than
 * throwing.
 */
import { tmuxBaseName } from './tmux-naming.js';
import { sendTmuxKeysRaw } from './tmux-send.ts';
import { healStaleTmuxSession } from './tmux-session.ts';
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

export async function launchAndBind(opts: {
  project: string;
  session: string;
  allowedTools?: string;
  invokeSkill?: string;
  model?: string;
  runtimeMode?: 'read-only' | 'edit' | 'bypass';
}): Promise<{ started: boolean; tmux?: string; bind?: 'pending'; reason?: string }> {
  try {
    if (!existsSync(opts.project)) return { started: false, reason: 'no-project-dir' };

    const tmux = tmuxBaseName(opts.project, opts.session);

    // Self-heal: a pre-fix session parked in the wrong dir would otherwise be
    // reused, launching claude against the wrong folder.
    await healStaleTmuxSession(tmux, opts.project);

    // Ensure the tmux session exists (map any spawn failure → no-tmux).
    try {
      const check = Bun.spawn(['tmux', 'has-session', '-t', tmux], { stdout: 'ignore', stderr: 'ignore' });
      const exists = (await check.exited) === 0;
      if (!exists) {
        const create = Bun.spawn(['tmux', 'new-session', '-d', '-s', tmux, '-c', opts.project], { stdout: 'ignore', stderr: 'ignore' });
        await create.exited;
      }
    } catch (e: any) {
      return { started: false, reason: 'no-tmux' };
    }

    // Launch Claude.
    const cmd = 'claude'
      + (opts.allowedTools ? ' --allowedTools "' + opts.allowedTools + '"' : '')
      + (opts.model ? ' --model ' + opts.model : '')
      + runtimeModeFlags(opts.runtimeMode);
    await sendTmuxKeysRaw(tmux, cmd);

    // Readiness: a fixed sleep (and even the SessionStart-hook session-id file,
    // which is written too early) sent /collab before the prompt was
    // interactive, so the keystrokes were lost. Instead poll the pane until the
    // status bar renders (Claude is interactive), then send /collab and VERIFY
    // it registered — retrying a couple times — since cold-start/MCP timing
    // varies.
    const capture = (): string => {
      try {
        const p = Bun.spawnSync(['tmux', 'capture-pane', '-t', tmux, '-p'], { stdout: 'pipe', stderr: 'ignore' });
        return p.stdout?.toString() ?? '';
      } catch { return ''; }
    };
    // The status bar (e.g. "🧠 0% ctx |" / "← for agents") only renders once the
    // TUI is interactive — a reliable "ready for input" marker. (The ❯ prompt and
    // welcome box appear earlier, during load, so they're not used.)
    const ready = (t: string) => /ctx\s*\||for agents/.test(t);
    for (let i = 0; i < 60; i++) { // up to ~60s
      await sleep(1000);
      if (ready(capture())) break;
    }
    await sleep(1500); // settle

    // Bind the collab session; resend if it didn't take.
    for (let attempt = 0; attempt < 3; attempt++) {
      await sendTmuxKeysRaw(tmux, '/collab ' + opts.session);
      await sleep(4000);
      if (/collab|server health|Vibe|register/i.test(capture())) break;
    }

    if (opts.invokeSkill) {
      await sleep(12000);
      await sendTmuxKeysRaw(tmux, opts.invokeSkill);
    }

    return { started: true, tmux, bind: 'pending' };
  } catch (e) {
    return { started: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
