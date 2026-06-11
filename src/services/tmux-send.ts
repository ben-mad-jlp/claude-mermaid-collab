import { tmuxBaseName } from './tmux-naming.js';

export interface TmuxSendResult {
  sent: boolean;
  reason?: 'no-session' | 'no-tmux';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Send text to a tmux session and submit it with a SEPARATE Enter keystroke.
 *
 * Sending text and Enter in a single `tmux send-keys ... <text> Enter` call
 * does NOT reliably submit in the Claude Code TUI — the text lands in the
 * input box but the trailing Enter is absorbed, so successive sends just stack
 * unsubmitted. Sending the literal text first (`-l`), then a standalone Enter
 * after a short delay, submits reliably (and works for plain shells too).
 *
 * `opts.submit` (default true) controls the trailing Enter: pass `submit:false`
 * to type the literal text only and SKIP the Enter — the compose / type-only
 * mode (QR3) where the user edits the staged text in the REPL before submitting.
 */
export interface TmuxSendOpts {
  /** When false, type the literal text only and skip the standalone Enter. */
  submit?: boolean;
}

export async function sendTmuxKeysRaw(
  tmuxSession: string,
  text: string,
  opts?: TmuxSendOpts,
): Promise<TmuxSendResult> {
  const submit = opts?.submit ?? true;
  try {
    const check = Bun.spawn(['tmux', 'has-session', '-t', tmuxSession], { stdout: 'ignore', stderr: 'ignore' });
    if ((await check.exited) !== 0) return { sent: false, reason: 'no-session' };
    // Type the literal text (no key-name interpretation), then submit with a
    // standalone Enter after a beat so the TUI registers the input first.
    const typed = Bun.spawn(['tmux', 'send-keys', '-t', tmuxSession, '-l', text], { stdout: 'ignore', stderr: 'ignore' });
    await typed.exited;
    // Compose / type-only: leave the text staged in the REPL, no submit.
    if (!submit) return { sent: true };
    await sleep(150);
    const enter = Bun.spawn(['tmux', 'send-keys', '-t', tmuxSession, 'Enter'], { stdout: 'ignore', stderr: 'ignore' });
    await enter.exited;
    return { sent: true };
  } catch (e: any) {
    console.warn(`[tmux-send] spawn failed (${e?.code ?? 'unknown'}): ${e?.message ?? String(e)} — soft no-op`);
    return { sent: false, reason: 'no-tmux' };
  }
}

/** Resolve the collab session's tmux name and send text to it (submit by default). */
export async function sendTmuxKeys(
  project: string,
  session: string,
  text: string,
  opts?: TmuxSendOpts,
): Promise<TmuxSendResult> {
  return sendTmuxKeysRaw(tmuxBaseName(project, session), text, opts);
}
