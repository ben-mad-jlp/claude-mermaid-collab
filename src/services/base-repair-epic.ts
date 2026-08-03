/**
 * Bounded, idempotent base-repair epic raiser — for the INFRA arm's fail verdict.
 *
 * When a leaf is INFRA-rejected on an UNKNOWN or un-recorded lane, the arm cannot yet
 * re-probe (no signature, no stored TTL state). A base-repair epic is a human intervention
 * lever: it admits "the base is red and the infra arm can't fix it mechanically — please
 * green the base and the arm will un-park the leaf automatically."
 *
 * Bounded: at most `BASE_REPAIR_ATTEMPT_CAP` repair epics per epic per `BASE_REPAIR_WINDOW_MS`.
 * Idempotent: an already-in-flight repair epic blocks a duplicate raise.
 */
import { createHash } from 'node:crypto';
import { listTodos, updateTodo, type Todo } from './todo-store.js';
import { isEpic } from './todo-kind.js';
import { createEpicWithLandLeaf, addLeavesToEpic, type LeafInput } from '../mcp/workgraph-tools.js';
import { WAKE_GATE_REPROBE_TTL_MS } from './conductor-wake-gate.js';
import { isLanded } from './epic-landedness.js';
import { listPassingBaseGatesSince } from './worker-ledger.js';

/** Stable dedupe marker embedded in the epic's description. Mirrors {@link infraRejectedMarker}
 *  shape and the epic branch's `laneSignature` format. Greppable.
 *  LEGACY shape — no longer produced by {@link raiseBaseRepairEpic}, but still present in live
 *  todo rows and matched by {@link BASE_REPAIR_LEGACY_TARGET_RE}. */
export function baseRepairMarker(epicId: string, laneSig: string): string {
  return `[base-repair:${epicId.slice(0, 8)}:${laneSig.slice(0, 8)}]`;
}

/** Stable, tip-independent lane identity for a (targetProject, trunkRef) pair. */
export function baseRepairLaneKey(targetProject: string, trunkRef: string): string {
  return `${targetProject.replace(/\/+$/, '')}\0${trunkRef}`;
}

/** Hashed, greppable lane marker embedded in the repair epic's description. */
export function baseRepairLaneMarker(laneKey: string): string {
  return `[base-repair-lane:${createHash('sha256').update(laneKey).digest('hex').slice(0, 8)}]`;
}

/** Tag identifying the surfacing epic, separate from the lane marker, so
 *  {@link reapSettledBaseRepairEpics} can resolve the target epic without keying dedupe on it. */
export function baseRepairTargetMarker(epicId: string): string {
  return `[base-repair-target:${epicId.slice(0, 8)}]`;
}

/** At most this many base-repair epics per red epic per window. */
export const BASE_REPAIR_ATTEMPT_CAP = 2;

/** Repair epics are bounded by the same TTL as the wake gate reprobe — a base
 *  repaired without a new commit should not spawn infinite repair attempts. */
export const BASE_REPAIR_WINDOW_MS = WAKE_GATE_REPROBE_TTL_MS;

/**
 * Partition base-repair epics by their terminal state and age.
 *
 * `open`: `status !== 'done' && status !== 'dropped'` — an in-flight or pending repair.
 * `attemptsInWindow`: terminal (`done` | `dropped`) epics whose `completedAt ?? updatedAt`
 *   is within `BASE_REPAIR_WINDOW_MS` of `now` — counts toward the cap; older attempts don't.
 */
export function findBaseRepairEpics(
  todos: Todo[],
  marker: string,
  now?: number,
): { open: Todo[]; attemptsInWindow: Todo[] } {
  const nowMs = now ?? Date.now();
  const open: Todo[] = [];
  const attemptsInWindow: Todo[] = [];

  for (const t of todos) {
    if (!isEpic(t) || t.baseRepair !== 1) continue;
    const desc = t.description ?? '';
    if (!desc.includes(marker)) continue;

    if (t.status !== 'done' && t.status !== 'dropped') {
      open.push(t);
    } else {
      const terminalAt = t.completedAt ?? t.updatedAt;
      if (terminalAt) {
        const terminalMs = typeof terminalAt === 'number' ? terminalAt : new Date(terminalAt).getTime();
        if (nowMs - terminalMs < BASE_REPAIR_WINDOW_MS) {
          attemptsInWindow.push(t);
        }
      }
    }
  }
  return { open, attemptsInWindow };
}

const BASE_REPAIR_TARGET_RE = /\[base-repair-target:([0-9a-f]{8})\]/;
const BASE_REPAIR_LEGACY_TARGET_RE = /\[base-repair:([0-9a-f]{8}):[0-9a-f]{8}\]/;

/**
 * Reap base-repair epics whose targeted lane has already settled (landed or dropped).
 *
 * Base-repair epics are raised for a human to hand-fix the base; nothing else notices
 * when the targeted epic resolves on its own. This scans all open base-repair epics,
 * resolves each marker's target epic, and drops the repair epic when the target is
 * landed or dropped — fail-open per repair epic so one bad entry doesn't stop the scan.
 */
export async function reapSettledBaseRepairEpics(
  project: string,
  io?: { listTodos?: typeof listTodos; updateTodo?: typeof updateTodo },
): Promise<string[]> {
  const listTodosFn = io?.listTodos ?? listTodos;
  const updateTodoFn = io?.updateTodo ?? updateTodo;

  const todos = listTodosFn(project, { includeCompleted: true });
  const byId8 = new Map<string, Todo>();
  for (const t of todos) {
    byId8.set(t.id.slice(0, 8), t);
  }

  const reaped: string[] = [];

  for (const t of todos) {
    if (!isEpic(t) || t.baseRepair !== 1 || t.status === 'done' || t.status === 'dropped') continue;

    const desc = t.description ?? '';
    const match = BASE_REPAIR_TARGET_RE.exec(desc) ?? BASE_REPAIR_LEGACY_TARGET_RE.exec(desc);
    if (!match) continue;

    const target = byId8.get(match[1]);
    if (!target) continue;

    if (!(isLanded(target) || target.status === 'dropped')) continue;

    try {
      await updateTodoFn(project, t.id, { status: 'dropped' });
      reaped.push(t.id);
    } catch {
      // fail-open: one bad repair epic must not stop the scan of the rest
    }
  }

  return reaped;
}

const BASE_REPAIR_LANE_ANY_RE = /\[base-repair-lane:[0-9a-f]{8}\]/;

export type LaneIsGreenFn = (project: string, sinceMs: number) => Promise<boolean>;

/**
 * Reap base-repair epics whose lane has self-healed (base gate passed after the epic was created).
 *
 * A lane that recovers without the targeted epic settling leaves the repair epic open forever
 * (reapSettledBaseRepairEpics only keys on the target's state). This scans all open base-repair
 * epics with a lane marker and drops them when laneIsGreen proves the lane has passed since
 * creation — fail-open per repair epic so one bad entry doesn't stop the scan.
 */
export async function reapRecoveredLaneBaseRepairEpics(
  project: string,
  io?: { listTodos?: typeof listTodos; updateTodo?: typeof updateTodo; laneIsGreen?: LaneIsGreenFn },
): Promise<string[]> {
  const listTodosFn = io?.listTodos ?? listTodos;
  const updateTodoFn = io?.updateTodo ?? updateTodo;
  const laneIsGreenFn = io?.laneIsGreen ?? defaultLaneIsGreen;

  const todos = listTodosFn(project, { includeCompleted: true });
  const reaped: string[] = [];

  for (const t of todos) {
    if (!isEpic(t) || t.baseRepair !== 1 || t.status === 'done' || t.status === 'dropped') continue;
    if (!BASE_REPAIR_LANE_ANY_RE.test(t.description ?? '')) continue;

    const createdAtMs = typeof t.createdAt === 'number' ? t.createdAt : new Date(t.createdAt as unknown as string).getTime();
    try {
      if (!(await laneIsGreenFn(project, createdAtMs))) continue;
      await updateTodoFn(project, t.id, { status: 'dropped' });
      reaped.push(t.id);
    } catch {
      // fail-open: one bad repair epic must not stop the scan of the rest
    }
  }
  return reaped;
}

async function defaultLaneIsGreen(project: string, sinceMs: number): Promise<boolean> {
  try {
    return listPassingBaseGatesSince(project, sinceMs).length > 0;
  } catch {
    return false; // unreadable ledger ⇒ never reap
  }
}

/**
 * Build the leaf's description for a base-repair leaf. MUST include both:
 *   - a fix directive (fix net-new failures as code-to-intent, or correct a stale assertion);
 *   - the exact prohibition string so the executor knows this is a guarded repair.
 */
export function buildRepairLeafSpec(args: {
  marker: string;
  cause: string;
  reasonTail: string;
  epicBranch: string;
}): string {
  return (
    `${args.marker}\n` +
    `\n` +
    `Red base: ${args.epicBranch}\n` +
    `Cause: ${args.cause}\n` +
    `\n` +
    `This base-repair epic is raised because the INFRA arm found the base red on a known lane ` +
    `and cannot mechanically fix it.\n` +
    `\n` +
    `INSTRUCTIONS:\n` +
    `1. Green the base by fixing the net-new failing test(s) as CODE-to-intent, or by correcting ` +
    `a provably-stale assertion.\n` +
    `2. do NOT weaken, skip or delete a test that catches a real gap — park and escalate instead.\n` +
    `3. Fail-closed behaviour: if the base cannot be greened without weakening a genuine check, ` +
    `park the leaf and let the human card stand.\n` +
    `\n` +
    `When the base is green, the INFRA arm will detect it and un-park the stuck leaves automatically.\n` +
    `\n` +
    `Original reason:\n` +
    `${args.reasonTail.slice(0, 2000)}`
  );
}

/** Argument shape for {@link raiseBaseRepairEpic}. */
export interface RaiseBaseRepairArgs {
  project: string;
  session: string;
  epicId: string;
  targetProject: string;
  laneSignature: string;
  trunkRef: string;
  cause: string;
  reasonTail: string;
  epicBranch: string;
  files?: string[];
}

/** Injectable IO for {@link raiseBaseRepairEpic}. Each field defaults to the live
 *  implementation. Hermetic tests inject fakes. */
export interface RaiseBaseRepairIo {
  listTodos?: typeof listTodos;
  createEpic?: typeof createEpicWithLandLeaf;
  addLeaves?: typeof addLeavesToEpic;
  updateTodo?: typeof updateTodo;
  now?: () => number;
}

/** Result of attempting to raise a base-repair epic. */
export interface RaiseBaseRepairResult {
  /** true when a new repair epic was created. */
  created: boolean;
  /** The id of the created epic (when `created === true`). */
  epicId?: string;
  /** Reason when `created === false`. */
  reason?: 'already-in-flight' | 'cap-reached';
}

/**
 * Raise a base-repair epic for a red leaf, bounded and idempotent.
 *
 * Returns `{created: false, reason: 'already-in-flight'}` if an open repair epic
 * for this marker already exists. Returns `{created: false, reason: 'cap-reached'}`
 * if `BASE_REPAIR_ATTEMPT_CAP` terminal epics have completed in the window. Otherwise
 * creates and returns `{created: true, epicId}`.
 *
 * The caller (conductor-infra-arm) is responsible for its own try/catch; this function
 * may throw on a genuine create failure.
 */
export async function raiseBaseRepairEpic(
  args: RaiseBaseRepairArgs,
  io?: RaiseBaseRepairIo,
): Promise<RaiseBaseRepairResult> {
  const laneKey = baseRepairLaneKey(args.targetProject, args.trunkRef);
  const laneMarker = baseRepairLaneMarker(laneKey);
  const targetMarker = baseRepairTargetMarker(args.epicId);
  const listTodosFn = io?.listTodos ?? listTodos;
  const createEpicFn = io?.createEpic ?? createEpicWithLandLeaf;
  const addLeavesFn = io?.addLeaves ?? addLeavesToEpic;
  const updateTodoFn = io?.updateTodo ?? updateTodo;

  const todos = listTodosFn(args.project, { includeCompleted: true });
  const { open, attemptsInWindow } = findBaseRepairEpics(todos, laneMarker, io?.now?.());

  if (open.length > 0) {
    return { created: false, reason: 'already-in-flight' };
  }

  if (attemptsInWindow.length >= BASE_REPAIR_ATTEMPT_CAP) {
    return { created: false, reason: 'cap-reached' };
  }

  const { epic } = await createEpicFn(args.project, args.session, {
    title: 'Base repair: ' + args.epicBranch,
    home: null,
    homeProvided: true,
    baseRepair: true,
    description:
      laneMarker + '\n' + targetMarker + '\n' + args.cause + '\n' + args.reasonTail.slice(0, 2000),
  });

  const leafSpec: LeafInput = {
    title: 'Repair red base',
    status: 'ready',
    files: args.files ?? [],
    description: buildRepairLeafSpec({
      marker: laneMarker,
      cause: args.cause,
      reasonTail: args.reasonTail,
      epicBranch: args.epicBranch,
    }),
  };

  await addLeavesFn(args.project, args.session, epic.id, [leafSpec]);

  await updateTodoFn(args.project, epic.id, { status: 'ready' });

  return { created: true, epicId: epic.id };
}
