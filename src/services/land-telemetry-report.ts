/**
 * Windowed land-telemetry report (read-only).
 *
 * Rolls up land cycles recorded in `epic_land_record` within a time window, cross-referenced
 * with the current work-graph (for non-terminal serving-leaf residue) and the
 * `main-checkout-residue` escalation kind (for main-checkout violations raised in the same
 * window). All reads; no store mutates.
 *
 * Every dependency is injectable so the report assembly is hermetically unit-testable without
 * a repo — same injection discipline as `buildLandReadiness` (epic-land-readiness.ts:108).
 */
import type { Todo } from './todo-store.js';
import { listTodos } from './todo-store.js';
import { isGateTodo } from './epic-land-readiness.js';
import { isEpicTodo, isLandTodo } from './invariant-check.js';
import { listEpicLandRecordsInWindow, type EpicLandRecord } from './epic-land-record-store.js';
import { listEscalationsByKindInWindow, type Escalation } from './supervisor-store.js';
import { readMainCheckoutHead } from './main-checkout-invariant.js';

/** The escalation kind `escalateMainCheckoutViolation` writes (main-checkout-escalation.ts:69). */
export const MAIN_CHECKOUT_ESCALATION_KIND = 'main-checkout-residue';

/** Which recorded field the land cycle's sha came from. `recordLandCycle` falls back to the
 *  land merge sha when the epic tip is unavailable (epic-land-record-store.ts:110-111) — this
 *  is the only signal the row carries about which path recorded it; it is NOT a stored
 *  `source` column. */
export type LandPath = 'epic-tip' | 'merge-sha-fallback';

export interface LandCycleTelemetry {
  epicId: string;
  landedAt: number;
  landedAtIso: string;
  landedMergeSha: string;
  epicTipSha: string;
  landPath: LandPath;
  nonTerminalServingLeafCount: number;
  nonTerminalServingLeafIds: string[];
  postLandStatusClean: boolean;
  postLandResidue: string[];
}

export interface LandTelemetryReport {
  window: { sinceMs: number; untilMs: number; sinceIso: string; untilIso: string };
  cycles: LandCycleTelemetry[];
  counts: {
    cycles: number;
    cyclesWithNonTerminalServingLeaf: number;
    cyclesWithDirtyCheckout: number;
  };
  mainCheckoutEscalations: { count: number; ids: string[] };
}

export interface LandTelemetryDeps {
  listRecords?: (project: string, sinceMs: number, untilMs: number) => EpicLandRecord[];
  listTodos?: (project: string) => Todo[];
  listEscalations?: (project: string, kind: string, sinceMs: number, untilMs: number) => Escalation[];
  /** Per-cycle residue probe, so a cycle CAN be attributed its own checkout state. The default
   *  implementation returns the report-time `readMainCheckoutHead` residue for every cycle —
   *  a report-time snapshot, NOT a historical post-land capture. */
  readResidue?: (project: string, cycle: EpicLandRecord) => Promise<string[]>;
}

/** Transitive descendants of `epicId` (cycle-safe walk, same `childrenOf`/`descendantsOf` shape
 *  as epic-land-readiness.ts:118-138) that are code leaves — excluding containers (>=1
 *  non-dropped child), gates, land leaves, and nested epics — and are NOT terminal
 *  (`status !== 'done' && acceptanceStatus !== 'accepted'`). Sorted ascending. This is the
 *  inverse of the `inScope` filter at epic-land-readiness.ts:156 — the blind spot that file
 *  skips is precisely what this report counts. */
function nonTerminalServingLeafIds(todos: Todo[], epicId: string): string[] {
  const childrenOf = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId) ?? [];
      arr.push(t);
      childrenOf.set(t.parentId, arr);
    }
  }

  const epic = todos.find((t) => t.id === epicId);
  if (!epic) return [];

  const descendantsOf = (root: Todo): Todo[] => {
    const result: Todo[] = [];
    const stack = [...(childrenOf.get(root.id) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      result.push(node);
      stack.push(...(childrenOf.get(node.id) ?? []));
    }
    return result;
  };

  const result: string[] = [];
  for (const desc of descendantsOf(epic)) {
    if (desc.status === 'dropped') continue;

    const nonDroppedChildren = (childrenOf.get(desc.id) ?? []).filter((c) => c.status !== 'dropped');
    if (nonDroppedChildren.length >= 1 || isGateTodo(desc) || isLandTodo(desc) || isEpicTodo(desc)) {
      continue;
    }

    const terminal = desc.status === 'done' || desc.acceptanceStatus === 'accepted';
    if (terminal) continue;

    result.push(desc.id);
  }

  result.sort();
  return result;
}

async function defaultReadResidue(project: string, _cycle: EpicLandRecord): Promise<string[]> {
  const runGit = async (cwd: string, gitArgs: string[]) => {
    const p = Bun.spawn(['git', ...gitArgs], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { code: code ?? 1, stdout, stderr };
  };
  const state = await readMainCheckoutHead(project, runGit);
  return state.residue;
}

/**
 * Assemble the windowed land-telemetry report. Every dependency defaults to the real store
 * implementation; pass `deps` to test the assembly logic hermetically.
 */
export async function reportLandCycles(
  project: string,
  opts: { sinceMs: number; untilMs: number },
  deps: LandTelemetryDeps = {},
): Promise<LandTelemetryReport> {
  const { sinceMs, untilMs } = opts;
  const listRecords = deps.listRecords ?? listEpicLandRecordsInWindow;
  const listTodosFn = deps.listTodos ?? ((p: string) => listTodos(p, { includeCompleted: true }));
  const listEscalationsFn = deps.listEscalations ?? listEscalationsByKindInWindow;
  const readResidue = deps.readResidue ?? defaultReadResidue;

  const records = listRecords(project, sinceMs, untilMs);
  const todos = listTodosFn(project);

  const cycles: LandCycleTelemetry[] = [];
  for (const rec of records) {
    const landPath: LandPath = rec.epicTipSha === rec.landedMergeSha ? 'merge-sha-fallback' : 'epic-tip';
    const servingLeafIds = nonTerminalServingLeafIds(todos, rec.epicId);
    const residue = await readResidue(project, rec);
    cycles.push({
      epicId: rec.epicId,
      landedAt: rec.landedAt,
      landedAtIso: new Date(rec.landedAt).toISOString(),
      landedMergeSha: rec.landedMergeSha,
      epicTipSha: rec.epicTipSha,
      landPath,
      nonTerminalServingLeafCount: servingLeafIds.length,
      nonTerminalServingLeafIds: servingLeafIds,
      postLandStatusClean: residue.length === 0,
      postLandResidue: residue,
    });
  }

  const escalations = listEscalationsFn(project, MAIN_CHECKOUT_ESCALATION_KIND, sinceMs, untilMs);

  return {
    window: {
      sinceMs,
      untilMs,
      sinceIso: new Date(sinceMs).toISOString(),
      untilIso: new Date(untilMs).toISOString(),
    },
    cycles,
    counts: {
      cycles: cycles.length,
      cyclesWithNonTerminalServingLeaf: cycles.filter((c) => c.nonTerminalServingLeafCount > 0).length,
      cyclesWithDirtyCheckout: cycles.filter((c) => c.postLandStatusClean === false).length,
    },
    mainCheckoutEscalations: {
      count: escalations.length,
      ids: escalations.map((e) => e.id),
    },
  };
}
