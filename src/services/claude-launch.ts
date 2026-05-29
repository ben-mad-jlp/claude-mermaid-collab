/**
 * Launches a Claude in the project dir (which MUST be trusted, else the trust
 * prompt swallows the /collab command), binds the session via /collab, and
 * optionally invokes a skill. Best-effort: returns a result object rather than
 * throwing.
 */
import { tmuxBaseName } from './tmux-naming.js';
import { sendTmuxKeysRaw } from './tmux-send.ts';
import { existsSync } from 'node:fs';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function launchAndBind(opts: {
  project: string;
  session: string;
  allowedTools?: string;
  invokeSkill?: string;
}): Promise<{ started: boolean; tmux?: string; bind?: 'pending'; reason?: string }> {
  try {
    if (!existsSync(opts.project)) return { started: false, reason: 'no-project-dir' };

    const tmux = tmuxBaseName(opts.project, opts.session);

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
    const cmd = 'claude' + (opts.allowedTools ? ' --allowedTools "' + opts.allowedTools + '"' : '');
    await sendTmuxKeysRaw(tmux, cmd);

    // Readiness: fixed 10s wait — simplest reliable approach.
    // Future optimization: poll for the claude PID instead of a fixed sleep.
    await sleep(10000);

    // Bind the collab session.
    await sendTmuxKeysRaw(tmux, '/collab ' + opts.session);

    if (opts.invokeSkill) {
      await sleep(12000);
      await sendTmuxKeysRaw(tmux, opts.invokeSkill);
    }

    return { started: true, tmux, bind: 'pending' };
  } catch (e) {
    return { started: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
