/**
 * conductor-infra-arm — the conductor's STUCK-WORK arm for INFRA-rejected leaves.
 *
 * A leaf parked by `parkBlocked('epic-base-red: …')` (leaf-executor's G2 base gate) is
 * INFRA-dead, not CONTENT-dead: nothing is wrong with its spec or its diff — the branch it
 * would build on was red (or the gate could not run, or the leaf was mis-homed). Its
 * rejection moves `rejectedParkedCount` exactly once; from then on the conductor
 * fingerprint (conductor-pass.ts) is CONSTANT and every later pass returns 'debounced' —
 * even after a commit repairs the base. The leaf never re-dispatches. That is the wedge.
 *
 * This arm is the deterministic un-wedger. It re-probes the failed precondition with the
 * SAME primitives the executor used (epicHeadSha → epic_base_gate cache → runBaseGate in
 * the epic worktree), and then either:
 *   - un-parks the leaf (`resetTodo` → ready) when the base is provably GREEN again, or
 *   - raises exactly ONE human card (deduped by a marker in questionText) when it is not.
 *
 * Fail CLOSED in both directions:
 *   - a rejection reason we do not recognise is CONTENT (`classifyInfraRejection` → null)
 *     and is NEVER auto-reset — the LLM's verdict stands;
 *   - a probe that cannot PROVE green ('fail' | 'error' | 'unknown') cards, never resets.
 *
 * Every git/gate touch is injected (`InfraArmDeps.probe`) so tests are hermetic, and the
 * live probe only ever works inside the epic's dedicated worktree via `ensureEpic` — the
 * user-facing main checkout is never mutated (standing constraint 75718390).
 */
import { listTodos, resetTodo, type Todo } from './todo-store.js';
import { isEpic } from './todo-kind.js';
import { listLeafRuns } from './ledger-stats.js';
import { createEscalation, listEscalations, type Escalation } from './supervisor-store.js';
import { epicBranchName } from './epic-branch-status.js';
import { getEpicBaseGate, recordEpicBaseGate } from './worker-ledger.js';
import { resolveGateDeclaration, runBaseGate, defaultGateSpawn } from './leaf-gate.js';
import { loadManifestSource } from '../config/project-manifest.js';

/** The INFRA causes an executor stamps as the HEAD of a park reason (leaf-executor's G2
 *  base gate + the mis-homed target guard). Everything else is CONTENT. */
export type InfraCause = 'epic-base-red' | 'epic-base-gate-could-not-run' | 'mis-homed-target';

/**
 * Classify a leaf's durable terminal reason (`LeafRunSummary.reason`). Matched in order so
 * the more specific gate-could-not-run head wins over the generic red head.
 *
 * ANYTHING unmatched — every review-findings reason, every spec failure, every empty-diff
 * park — returns `null` = CONTENT. That is the fail-closed default: this arm only ever
 * un-parks work whose failure it can positively identify as infrastructure.
 */
export function classifyInfraRejection(reason: string | null): InfraCause | null {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (r.includes('epic-base-gate-could-not-run') || r.includes('gate could not run')) {
    return 'epic-base-gate-could-not-run';
  }
  if (r.includes('epic-base-red')) return 'epic-base-red';
  if (r.includes('mis-homed')) return 'mis-homed-target';
  return null;
}

export interface InfraCandidate {
  leafId: string;
  epicId: string;
  cause: InfraCause;
  reason: string;
}

/**
 * The mission's INFRA-rejected leaves: a leaf whose acceptance is `rejected` AND whose
 * LATEST ledger run terminated `rejected`/`blocked` with an INFRA reason.
 *
 * The latest-run outcome is also the "no live sibling serve" test: a `pending`/`paused`
 * (or absent) latest run means the leaf is IN FLIGHT right now, and touching it would race
 * the executor — so it is skipped.
 */
export function collectInfraRejectedLeaves(project: string, missionId: string): InfraCandidate[] {
  const allTodos = listTodos(project, { includeCompleted: true });
  const epics = allTodos.filter(
    (t) => t.parentId === missionId && isEpic(t) && t.status !== 'done' && t.status !== 'dropped',
  );
  if (epics.length === 0) return [];
  const byId = new Map(allTodos.map((t) => [t.id, t]));
  const out: InfraCandidate[] = [];
  for (const epic of epics) {
    let runs: ReturnType<typeof listLeafRuns> = [];
    try {
      runs = listLeafRuns({ project, epicId: epic.id });
    } catch {
      runs = []; // fail-open: a ledger hiccup must never break the pass
    }
    for (const run of runs) {
      if (run.finalOutcome !== 'rejected' && run.finalOutcome !== 'blocked') continue;
      const leaf = byId.get(run.leafId);
      if (!leaf || leaf.acceptanceStatus !== 'rejected') continue;
      const cause = classifyInfraRejection(run.reason);
      if (!cause) continue; // CONTENT — never this arm's business
      out.push({ leafId: leaf.id, epicId: epic.id, cause, reason: run.reason ?? '' });
    }
  }
  return out;
}

/** The kind stamped on an INFRA-rejection card. One OPEN card per leaf at a time. */
export const INFRA_REJECTED_KIND = 'leaf-infra-rejected';

/** Dedupe marker embedded in the card's questionText so an open card can be matched back
 *  to an exact leaf (mirrors serveCapMarker in conductor-pass). Stable + greppable. */
export function infraRejectedMarker(leafId: string): string {
  return `[infra-rejected:${leafId.slice(0, 8)}]`;
}

/** 'pass' is the ONLY verdict that un-parks a leaf. 'unknown' = we could not even run the
 *  probe (no gate declared, non-git, a throw) — never a fabricated green. */
export type BaseProbeVerdict = 'pass' | 'fail' | 'error' | 'unknown';

export type EpicBaseProbe = (epicId: string, targetProject: string) => Promise<BaseProbeVerdict>;

/**
 * LIVE re-probe of an epic's base, from the same primitives as the executor's
 * `ensureBaseGreen`: the cache row is keyed to the base commit it examined, so a commit that
 * REPAIRS the base is already a cache MISS and the gate simply re-runs — no invalidation
 * code exists or is needed. Runs in the epic's dedicated worktree (`ensureEpic`), never the
 * main checkout. Any throw degrades to 'unknown' (⇒ card, not reset).
 */
export const defaultEpicBaseProbe: EpicBaseProbe = async (epicId, targetProject) => {
  try {
    // Lazy imports: the live probe pulls the (heavy) worktree/executor surface, but the
    // classifier + collector must stay cheap to import for the pass and its tests.
    const { getWorktreeManager } = await import('./coordinator-live.js');
    const { isCacheableBaseGateStatus } = await import('./leaf-executor.js');
    const wm = getWorktreeManager(targetProject);
    const sha = await wm.epicHeadSha(epicId);
    const cached = getEpicBaseGate(epicId, sha);
    if (cached) return cached.status === 'pass' ? 'pass' : cached.status === 'fail' ? 'fail' : 'error';

    const gateDecl = resolveGateDeclaration(loadManifestSource(targetProject));
    // No declared gate (absent / misconfigured) ⇒ we cannot PROVE the base is green, and an
    // abstention must never read as one.
    if (gateDecl.kind !== 'declared') return 'unknown';
    const wt = await wm.ensureEpic(epicId, targetProject);
    if (!wt) return 'unknown'; // non-git fallback ⇒ no base gate
    const r = await runBaseGate(wt.path, gateDecl.cfg, defaultGateSpawn);
    if (isCacheableBaseGateStatus(r.status)) {
      recordEpicBaseGate({
        epicId,
        project: targetProject,
        baseSha: sha,
        status: r.status,
        command: r.command ?? null,
        output: r.output || null,
      });
    }
    return r.status === 'pass' ? 'pass' : r.status === 'fail' ? 'fail' : 'error';
  } catch {
    return 'unknown';
  }
};

export interface InfraArmDeps {
  probe?: EpicBaseProbe;
  createEscalation?: typeof createEscalation;
  listOpenEscalations?: () => Escalation[];
  reset?: typeof resetTodo;
}

export interface InfraArmResult {
  candidates: InfraCandidate[];
  /** Leaf ids actually un-parked this pass (probe proved the base green again). */
  reset: string[];
  cardsRaised: number;
}

/**
 * Run the arm for one mission: re-probe every INFRA-rejected leaf, un-park the ones whose
 * precondition is provably repaired, card the rest exactly once.
 *
 * Each candidate is handled in its own try/catch — one bad probe or one card-store hiccup
 * must never sink the conductor pass (the fail-open discipline of the serve-cap block).
 */
export async function runInfraRejectionArm(
  project: string,
  missionId: string,
  session: string,
  deps: InfraArmDeps = {},
): Promise<InfraArmResult> {
  const candidates = collectInfraRejectedLeaves(project, missionId);
  const result: InfraArmResult = { candidates, reset: [], cardsRaised: 0 };
  if (candidates.length === 0) return result;

  const probe = deps.probe ?? defaultEpicBaseProbe;
  const createEsc = deps.createEscalation ?? createEscalation;
  const resetFn = deps.reset ?? resetTodo;
  const listOpen = deps.listOpenEscalations ?? (() =>
    listEscalations().filter((e) => e.status === 'open' || e.status === 'acknowledged'));
  let open: Escalation[] = [];
  try { open = listOpen(); } catch { open = []; }

  const todos = listTodos(project, { includeCompleted: true });
  const byId = new Map<string, Todo>(todos.map((t) => [t.id, t]));

  for (const c of candidates) {
    try {
      const leaf = byId.get(c.leafId);
      const epic = byId.get(c.epicId);
      const targetProject = leaf?.targetProject ?? epic?.targetProject ?? project;
      // A mis-homed leaf is never mechanically clearable (the routing is the defect) — go
      // straight to the card path without touching git.
      const verdict: BaseProbeVerdict =
        c.cause === 'mis-homed-target' ? 'unknown' : await probe(c.epicId, targetProject);

      if (verdict === 'pass') {
        // resetTodo clears acceptanceStatus, zeroes retryCount, auto-resolves stale
        // escalations and kicks the orchestrator — the leaf re-dispatches on its own tick.
        await resetFn(project, c.leafId, 'ready');
        result.reset.push(c.leafId);
        continue;
      }

      const marker = infraRejectedMarker(c.leafId);
      const already = open.some((e) =>
        (e.status === 'open' || e.status === 'acknowledged') &&
        e.kind === INFRA_REJECTED_KIND && e.project === project &&
        e.todoId === c.leafId && e.questionText.includes(marker));
      if (already) continue;
      createEsc({
        project,
        session,
        kind: INFRA_REJECTED_KIND,
        todoId: c.leafId,
        operatorGated: true,
        questionText:
          `Leaf ${c.leafId.slice(0, 8)} ${marker} is parked on an INFRASTRUCTURE failure ` +
          `(${c.cause}), not on its content — nothing about its spec or diff is wrong.\n` +
          `epic branch: ${epicBranchName(c.epicId)}\n` +
          `re-probe verdict: ${verdict} — the precondition is still not provably green, so the ` +
          `leaf was NOT un-parked.\n` +
          `original reason:\n${c.reason.slice(0, 2000)}\n` +
          `Repair the base on that branch (or re-home the leaf) and commit; the next conductor ` +
          `pass re-probes and releases the leaf automatically.`,
      });
      result.cardsRaised++;
    } catch {
      // fail-open per candidate — one bad probe/card must not sink the pass.
    }
  }
  return result;
}
