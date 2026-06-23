import { tmuxBaseName } from './tmux-naming.js';
import { mux, argvHasSession, argvSendKeysLiteral, argvSendKeysEnter, argvSendKeysNames } from './session-mux/index.ts';

export interface TmuxSendResult {
  sent: boolean;
  reason?: 'no-session' | 'no-tmux' | 'bad-selection';
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
    const check = Bun.spawn(mux.cmd(argvHasSession(tmuxSession)), { stdout: 'ignore', stderr: 'ignore' });
    if ((await check.exited) !== 0) return { sent: false, reason: 'no-session' };
    // Type the literal text (no key-name interpretation), then submit with a
    // standalone Enter after a beat so the TUI registers the input first.
    const typed = Bun.spawn(mux.cmd(argvSendKeysLiteral(tmuxSession, text)), { stdout: 'ignore', stderr: 'ignore' });
    await typed.exited;
    // Compose / type-only: leave the text staged in the REPL, no submit.
    if (!submit) return { sent: true };
    await sleep(150);
    const enter = Bun.spawn(mux.cmd(argvSendKeysEnter(tmuxSession)), { stdout: 'ignore', stderr: 'ignore' });
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

// ---------------------------------------------------------------------------
// Multi-select answering (Claude Code AskUserQuestion multiSelect)
// ---------------------------------------------------------------------------

/**
 * One step in the keystroke plan that answers a Claude Code multi-select prompt.
 * `literal:true` types the value as text (the toggle digit); `literal:false` sends
 * `value` as a KEY NAME (`Right`/`Enter`). Verified against Claude Code v2.1.185:
 * a digit toggles that option's checkbox without moving the cursor or submitting,
 * then `Right` opens the review/Submit tab and `Enter` confirms "Submit answers".
 */
export interface SelectionStep {
  literal: boolean;
  value: string;
}

/** Upper bound on directly-addressable options — single-digit toggles only. */
export const MAX_SELECTION_OPTION = 9;

/**
 * Pure planner: the ordered keystrokes that toggle `numbers` (1-based option numbers
 * AS DISPLAYED) and submit. Deduped, sorted ascending for determinism. Returns null
 * when the selection can't be driven safely — empty, non-integer, out of 1..9 — so the
 * caller can fall back to "answer in the terminal" rather than mis-address rows.
 */
export function planSelectionKeystrokes(numbers: number[]): SelectionStep[] | null {
  const valid = [...new Set(numbers)].sort((a, b) => a - b);
  if (valid.length === 0) return null;
  if (valid.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_SELECTION_OPTION)) return null;
  return [
    ...valid.map((n): SelectionStep => ({ literal: true, value: String(n) })),
    { literal: false, value: 'Right' }, // → review / Submit tab
    { literal: false, value: 'Enter' }, // confirm "Submit answers"
  ];
}

/**
 * Drive a multi-select answer into a tmux session: toggle the chosen options then
 * submit. Each keystroke is a discrete send-keys call with a short delay so the TUI
 * registers it (same rationale as the literal+Enter split above). Returns
 * `{sent:false, reason:'bad-selection'}` if the plan is unsafe (caller should fall back).
 */
export async function sendTmuxSelectionRaw(
  tmuxSession: string,
  numbers: number[],
): Promise<TmuxSendResult> {
  const plan = planSelectionKeystrokes(numbers);
  if (!plan) return { sent: false, reason: 'bad-selection' };
  try {
    const check = Bun.spawn(mux.cmd(argvHasSession(tmuxSession)), { stdout: 'ignore', stderr: 'ignore' });
    if ((await check.exited) !== 0) return { sent: false, reason: 'no-session' };
    for (const step of plan) {
      const argv = step.literal
        ? argvSendKeysLiteral(tmuxSession, step.value)
        : argvSendKeysNames(tmuxSession, [step.value]);
      const spawned = Bun.spawn(mux.cmd(argv), { stdout: 'ignore', stderr: 'ignore' });
      await spawned.exited;
      await sleep(150);
    }
    return { sent: true };
  } catch (e: any) {
    console.warn(`[tmux-send] selection spawn failed (${e?.code ?? 'unknown'}): ${e?.message ?? String(e)} — soft no-op`);
    return { sent: false, reason: 'no-tmux' };
  }
}

/** Resolve the collab session's tmux name and drive a multi-select answer into it. */
export async function sendTmuxSelection(
  project: string,
  session: string,
  numbers: number[],
): Promise<TmuxSendResult> {
  return sendTmuxSelectionRaw(tmuxBaseName(project, session), numbers);
}
