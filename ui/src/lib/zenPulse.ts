import type { SessionTodo } from '@/types/sessionTodo';
import { buildById, claimReason } from '@/lib/claimability';

// Zen "Pulse" — spark next work when a session goes idle WITHOUT a question (design
// doc design-zen-spark-work). The idle invitation is a slow temporal gradient off
// `now - paneSeenAt`, so it can never produce a nag-moment: nothing pops, the header
// stays green, attention only warms over minutes. Pure + unit-tested.

export type PulseStage = 'off' | 'paused' | 'settled' | 'warm' | 'glowing';

// Tunable thresholds (single source of truth — NOT load-bearing for correctness).
export const PAUSE_MS = 45_000;    // 0–45s: indistinguishable from today
export const WARM_MS = 240_000;    // 45s–4m: a whisper (text only)
export const GLOW_MS = 900_000;    // 4m–15m: one action chip; 15m+: soft halo ceiling

/**
 * The idle warm-up stage as a pure function of continuous-quiet time (now - paneSeenAt).
 * `dismissedAt` sleeps the lane for the CURRENT idle episode: while it equals the live
 * `paneSeenAt`, the stage is 'off'. A real activity burst advances `paneSeenAt`, which
 * both re-arms (resets the clock to a fresh episode) AND clears the dismissal — the
 * once-per-episode + re-arm invariant falls out of this for free. Callers gate this on
 * the session actually being idle (green); a non-idle session should pass 'off' through.
 */
export function pulseStage(paneSeenAt: number | undefined, now: number, dismissedAt: number): PulseStage {
  if (!paneSeenAt) return 'off';
  if (dismissedAt === paneSeenAt) return 'off'; // dismissed this episode (re-arms when paneSeenAt advances)
  const quiet = now - paneSeenAt;
  if (quiet < PAUSE_MS) return 'paused';
  if (quiet < WARM_MS) return 'settled';
  if (quiet < GLOW_MS) return 'warm';
  return 'glowing';
}

/** Stages where the card surfaces an action chip and floats (rank tier 2.5). */
export function isArmed(stage: PulseStage): boolean {
  return stage === 'warm' || stage === 'glowing';
}

/** Stages where the Pulse line replaces the plain "updated Ns ago" footer. */
export function isPulsing(stage: PulseStage): boolean {
  return stage === 'settled' || stage === 'warm' || stage === 'glowing';
}

const isEpic = (t: SessionTodo) => /^\s*\[EPIC\]/i.test(t.title ?? '');

/**
 * The single next-ready leaf for a project: claimable / human-assignee, lowest priority
 * then order. Mirrors the funnel "Ready" predicate VERBATIM (claimReason) — never inlines
 * `status === 'ready'`. Epics are skipped (they're parents, not startable leaves).
 */
export function nextReadyTodo(todos: SessionTodo[]): SessionTodo | null {
  const byId = buildById(todos);
  return todos
    .filter((t) => !isEpic(t))
    .filter((t) => { const r = claimReason(t, byId); return r === 'claimable' || r === 'human-assignee'; })
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.order - b.order)[0] ?? null;
}

export interface NextUp {
  mode: 'ready' | 'blocked' | 'empty';
  leaf?: SessionTodo;
  /** Title of the unmet dependency we're waiting on (blocked mode) — honesty, no fake offer. */
  blockedBy?: string;
}

/**
 * What's next for a project: a ready leaf (the hero chip), else a real-but-blocked leaf
 * (named honestly, no action), else empty. Lets the card never lie about available work.
 */
export function nextUp(todos: SessionTodo[]): NextUp {
  const ready = nextReadyTodo(todos);
  if (ready) return { mode: 'ready', leaf: ready };
  const byId = buildById(todos);
  const blocked = todos
    .filter((t) => !isEpic(t) && claimReason(t, byId) === 'deps-pending')
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.order - b.order)[0];
  if (blocked) {
    const depTitle = (blocked.dependsOn ?? [])
      .map((id) => byId.get(id))
      .find((d) => d && d.status !== 'done')?.title;
    return { mode: 'blocked', leaf: blocked, blockedBy: depTitle ?? undefined };
  }
  return { mode: 'empty' };
}

/** Is this the special Inbox epic (planning-only parent)? */
const isInboxEpic = (t: SessionTodo): boolean => isEpic(t) && /inbox/i.test(t.title ?? '');

/** A filed epic plus its single next-ready child leaf (the startable thing) + a ready count.
 *  Tapping an epic resolves to starting that child — an epic itself isn't claimable. */
export interface EpicNext {
  epic: SessionTodo;
  nextChild: SessionTodo | null;
  readyCount: number;
}

/** The grounded next-work candidates for a project's What's-Next panel: ready leaves to
 *  start, filed epics (→ their next-ready child), and Inbox planning items. Pure selector
 *  over the already-loaded todos — reuses claimReason verbatim, no inlined status checks. */
export interface NextWork {
  ready: SessionTodo[];
  epics: EpicNext[];
  inbox: SessionTodo[];
}

export function nextWorkSuggestions(todos: SessionTodo[], cap = 5): NextWork {
  const byId = buildById(todos);
  const isReady = (t: SessionTodo): boolean => {
    const r = claimReason(t, byId);
    return r === 'claimable' || r === 'human-assignee';
  };
  const byPriority = (a: SessionTodo, b: SessionTodo) =>
    (a.priority ?? 9) - (b.priority ?? 9) || a.order - b.order;

  const ready = todos.filter((t) => !isEpic(t) && isReady(t)).sort(byPriority).slice(0, cap);

  const inbox = todos
    .filter((t) => claimReason(t, byId) === 'inbox-planning')
    .sort(byPriority)
    .slice(0, cap);

  const epics = todos
    .filter((t) => isEpic(t) && !isInboxEpic(t) && t.status !== 'done')
    .sort(byPriority)
    .slice(0, cap)
    .map((epic): EpicNext => {
      const readyChildren = todos.filter((c) => c.parentId === epic.id && !isEpic(c) && isReady(c)).sort(byPriority);
      return { epic, nextChild: readyChildren[0] ?? null, readyCount: readyChildren.length };
    });

  return { ready, epics, inbox };
}

/** Leading-8-hex short id (project convention). */
export const id8 = (id: string): string => id.slice(0, 8);

/** The grounded directive nudged into a session to start a ready leaf (NOT a graph
 *  mutation — we can't claim; the Orchestrator owns claims). */
export function startLeafDirective(leaf: SessionTodo): string {
  return `Pick up the next ready todo: ${leaf.title} (${id8(leaf.id)}). Start now.`;
}
