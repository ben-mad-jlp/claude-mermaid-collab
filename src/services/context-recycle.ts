import type { SessionStatusRow } from './session-status-store';
import {
  getStatuses,
  setRecycleState,
  isCheckpointReady,
  clearCheckpointReady,
  resetWatchdogDebounce,
  tryEmitWatchdogAction,
} from './session-status-store';
import { selectWatchdogActions, DEFAULT_WATCHDOG_CONFIG, type WatchdogCandidate } from './context-watchdog';
import {
  getContextRecycleMode,
  getWatchdogThreshold,
  isSupervisorPaused,
  createEscalation,
  recordSupervisorAudit,
  type ContextRecycleMode,
} from './supervisor-store';
import { nudgeSession } from './claude-launch';

/**
 * Context-auto-recycle DRIVER (Phase 1 of the convergence-loop work).
 *
 * A deterministic, server-side pass — no LLM supervisor in the loop — that keeps a
 * long-running WATCHED session alive across a context fill by driving the recovery
 * macro the tool already exposes piecemeal:
 *
 *   detect high context  →  /vibe-checkpoint  →  (session writes ## Checkpoint,
 *   calls checkpoint_ready)  →  /clear  →  settle  →  /collab <session>  (RESUME)
 *
 * The resume is ONE prompt by design. Role restoration rides the `register_claude_session`
 * round-trip that /collab already makes (server returns `sessionRole`, the skill loads it) —
 * NOT a second injection, which would race the TUI's stdin. The `recover` case body still
 * contains exactly one `nudge(...)` call (the acceptance criterion is preserved).
 *
 * Gated by the per-project `contextRecycleMode` (off | notify | force). A Claude
 * session cannot `/clear` itself (slash commands are client-side user input), so the
 * server must inject the clear + reload — that is the gap this closes. The `/collab`
 * re-inject is the step the legacy watchdog never had (it stopped at `/clear`).
 *
 * Sequencing is split across ticks via a durable `recycleState` on the session_status
 * row so it survives a server restart and re-gates idle before each injection rather
 * than blasting slash commands back-to-back. The pure `planRecycleStep` decides
 * WHAT to do; the runner applies it (all tmux/DB effects), mirroring the
 * context-watchdog selector/handler split.
 */

/** Wait after a /clear before injecting /collab, so the reload doesn't race the
 *  clear animation / the TUI returning to its prompt. */
export const RECYCLE_COLLAB_SETTLE_MS = 4_000;
/** If a session is still 'recovering' after this long (couldn't re-inject /collab),
 *  give up auto-driving and escalate to a human. */
export const RECYCLE_RECOVER_TIMEOUT_MS = 5 * 60 * 1000;
/** Cooldown between repeated /vibe-checkpoint nudges to the same session. */
export const RECYCLE_CHECKPOINT_COOLDOWN_MS = 10 * 60 * 1000;
/** Cooldown between repeated advisory (notify-mode) nudges to the same session. */
export const RECYCLE_ADVISORY_COOLDOWN_MS = 10 * 60 * 1000;

export type RecycleStepKind =
  | 'none'
  | 'inject-checkpoint'
  | 'inject-advisory'
  | 'clear'
  | 'recover'
  | 'recover-timeout';

/**
 * PURE planner: given a session row, the project's recycle mode, and this tick's
 * watchdog verdict for that row, decide the single recycle step to take. No I/O.
 *
 * - A row mid-recycle (recycleState==='recovering') is handled first: wait out the
 *   settle window, then re-inject /collab, or time out to an escalation.
 * - Otherwise the watchdog action drives it: 'clear' (a fresh checkpoint authorizes
 *   the wipe) or 'checkpoint' (over threshold + idle → nudge the session to save).
 *   In 'force' mode the server injects /vibe-checkpoint; in 'notify' mode it only
 *   posts an advisory and lets the session checkpoint itself (assisted, never forced).
 */
export function planRecycleStep(
  row: Pick<SessionStatusRow, 'recycleState' | 'recycleUpdatedAt'>,
  mode: ContextRecycleMode,
  action: WatchdogCandidate | null,
  now: number,
  settleMs: number = RECYCLE_COLLAB_SETTLE_MS,
  timeoutMs: number = RECYCLE_RECOVER_TIMEOUT_MS,
): RecycleStepKind {
  if (mode === 'off') return 'none';
  if (row.recycleState === 'recovering') {
    const age = now - (row.recycleUpdatedAt ?? 0);
    if (age > timeoutMs) return 'recover-timeout';
    if (age < settleMs) return 'none';
    return 'recover';
  }
  if (!action) return 'none';
  if (action.action === 'clear') return 'clear';
  if (action.action === 'checkpoint') return mode === 'force' ? 'inject-checkpoint' : 'inject-advisory';
  return 'none';
}

/** The advisory line injected in 'notify' mode — a heads-up, not a slash command. */
export function advisoryText(row: Pick<SessionStatusRow, 'contextPercent'>): string {
  const pct = row.contextPercent != null ? `${row.contextPercent}%` : 'high';
  return `⚠️ Context ${pct} — run /vibe-checkpoint to recycle; I'll /clear and reload once it's saved.`;
}

/** Injectable seams so the runner is unit-testable without a real tmux/DB. */
export interface RecycleDeps {
  now?: number;
  nudge?: (project: string, session: string, text: string) => Promise<'sent' | 'busy' | 'no-tmux'>;
  getStatuses?: (project: string) => SessionStatusRow[];
  getMode?: (project: string) => ContextRecycleMode;
  getThreshold?: (project: string) => number | null;
  /** GLOBAL emergency-pause check. Deliberately NOT per-project (see runner). */
  isPaused?: () => boolean;
}

/**
 * One context-recycle tick for a single WATCHED project. Inert unless the project's
 * mode is 'notify'/'force'. Best-effort per session; a failure on one session never
 * aborts the others (the caller wraps this in the orchestrator tick's per-pass
 * try/catch + timeout).
 */
export async function runContextRecyclePass(project: string, deps: RecycleDeps = {}): Promise<void> {
  const getMode = deps.getMode ?? getContextRecycleMode;
  const mode = getMode(project);
  if (mode === 'off') return;
  // Gate ONLY on a GLOBAL emergency pause — NOT the per-project supervisor pause.
  // `contextRecycleMode` is this feature's explicit per-project control; a per-project
  // supervisor pause (which stops LLM work-driving) must not silently override an
  // operator who deliberately set notify/force — otherwise a long-idle project pause
  // makes the setting a no-op with no feedback. A global pause still stops everything.
  const isPaused = deps.isPaused ?? (() => isSupervisorPaused());
  if (isPaused()) return;

  const now = deps.now ?? Date.now();
  const nudge = deps.nudge ?? nudgeSession;
  const rows = (deps.getStatuses ?? getStatuses)(project);
  const threshold = (deps.getThreshold ?? getWatchdogThreshold)(project) ?? DEFAULT_WATCHDOG_CONFIG.thresholdPercent;
  const cfg = { ...DEFAULT_WATCHDOG_CONFIG, thresholdPercent: threshold };
  const actionBySession = new Map(selectWatchdogActions(rows, now, cfg).map((a) => [a.session, a] as const));

  for (const row of rows) {
    const action = actionBySession.get(row.session) ?? null;
    const step = planRecycleStep(row, mode, action, now);
    try {
      switch (step) {
        case 'inject-checkpoint':
          if (tryEmitWatchdogAction(project, row.session, 'checkpoint', RECYCLE_CHECKPOINT_COOLDOWN_MS, now)) {
            // Don't let a failed inject (busy/no-tmux) hold the 10-min cooldown —
            // reset the debounce so the next tick retries instead of going silent.
            if ((await nudge(project, row.session, '/vibe-checkpoint')) !== 'sent') {
              resetWatchdogDebounce(project, row.session);
            }
          }
          break;
        case 'inject-advisory':
          if (tryEmitWatchdogAction(project, row.session, 'recycle-advisory', RECYCLE_ADVISORY_COOLDOWN_MS, now)) {
            if ((await nudge(project, row.session, advisoryText(row))) !== 'sent') {
              resetWatchdogDebounce(project, row.session);
            }
          }
          break;
        case 'clear': {
          // Defense-in-depth: the selector's 'clear' already implies a fresh
          // checkpoint marker, but re-assert the HARD GATE right before the wipe.
          if (!isCheckpointReady(project, row.session)) break;
          const r = await nudge(project, row.session, '/clear');
          if (r === 'sent') {
            clearCheckpointReady(project, row.session);
            resetWatchdogDebounce(project, row.session);
            setRecycleState(project, row.session, 'recovering');
            recordSupervisorAudit({ kind: 'clear', project, session: row.session, detail: 'context-recycle:cleared' });
          }
          break;
        }
        case 'recover': {
          const r = await nudge(project, row.session, `/collab ${row.session}`);
          if (r === 'sent') {
            setRecycleState(project, row.session, null);
            recordSupervisorAudit({ kind: 'clear', project, session: row.session, detail: 'context-recycle:reloaded' });
          }
          // 'busy'/'no-tmux' → leave state 'recovering'; retried next tick until timeout.
          break;
        }
        case 'recover-timeout':
          setRecycleState(project, row.session, null);
          createEscalation({
            project,
            session: row.session,
            kind: 'blocker',
            questionText: `Context-recycle stalled: cleared "${row.session}" but could not re-inject /collab to reload it. Resume the session manually.`,
          });
          recordSupervisorAudit({ kind: 'escalate', project, session: row.session, detail: 'context-recycle:recover-timeout' });
          break;
        case 'none':
        default:
          break;
      }
    } catch (err) {
      console.warn(`[context-recycle] ${project}/${row.session} step '${step}' failed:`, err);
    }
  }
}
