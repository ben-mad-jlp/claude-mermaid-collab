/**
 * base-gate-impacted.ts — impacted-set narrowing for the EPIC BASE gate, anchored on a
 * full-suite green of trunk.
 *
 * An epic base B is `trunk M forward-integrated + the epic's own commits`. When M itself
 * carries a stored FULL-SUITE PASS in the durable shared-verdict layer
 * (base_gate_verdict, base-gate-coalescer.ts), the only thing B adds over M is the diff
 * M..B — so the base gate only needs to run the impacted set of that diff, computed by the
 * SAME planner (`planImpactedFloor`) with the SAME fallback triggers the land-gate floor
 * uses (infra paths, unresolvable changed file, empty-set-on-code-change, >60% cap).
 *
 * Every uncertainty falls back to the FULL suite: no anchor, an anchor we cannot prove is
 * full-suite, a failed git probe, or any planner trigger. The impacted path is an
 * optimization, never a correctness relaxation.
 *
 * SAFETY NET: `ensureTrunkAnchor` (trunk-anchor.ts) is the real anchor producer — a capped,
 * coalesced FULL-suite gate at the current trunk sha, fired after every successful land and
 * lazily on every anchor-lookup miss below. Full-suite green anchors keep being produced,
 * and any test the static import graph misses self-surfaces on that next full trunk run —
 * an impacted miss is a delayed signal, never a lost one.
 */
import type { LeafGateConfig, LeafGateResult } from './leaf-gate.js';
import { planImpactedFloor, type FloorPlan } from './impacted-tests';
import { baseGateKey, sharedVerdictKey } from './base-gate-coalescer.js';
import { getBaseGateVerdict, type BaseGateVerdictRow } from './worker-ledger.js';
import { resolveTrunkRef, defaultGitRunner, type GitRunner } from './trunk-ref.js';

/** Base-gate lane commands that understand `--files=` — only these can be narrowed to the
 *  impacted set. Anything else keeps its declared command verbatim (mirrors the land
 *  gate's FLOOR_FILES_CAPABLE_RE in epic-land-gate.ts). */
export const BASE_FILES_CAPABLE_RE = /scripts\/test-backend(\.ts)?\b/;

export interface ImpactedBaseGateOpts {
  /** Target project path — the first leg of the anchor's shared-verdict key. */
  project: string;
  /** The epic base sha B being gated (checked out in the worktree the gate runs in). */
  baseSha: string;
  /** Current active-quarantine-set hash — the anchor row must be keyed under the SAME set. */
  quarantineHash: string;
  /** Injectable git (tests). Defaults to trunk-ref.ts's defaultGitRunner. */
  runGit?: GitRunner;
  /** Injectable impacted planner (tests). Defaults to planImpactedFloor. */
  planner?: (p: { repoRoot: string; changedFiles: string[] }) => FloorPlan;
  /** Injectable anchor-verdict lookup (tests). Defaults to worker-ledger getBaseGateVerdict. */
  getVerdict?: (key: string) => BaseGateVerdictRow | null;
  /** Injectable anchor producer, fired (fire-and-forget) on an anchor-lookup MISS so the
   *  anchor exists for the NEXT asker. Defaults to trunk-anchor.ts's ensureTrunkAnchor,
   *  loaded lazily (dynamic import) to keep the module graph acyclic. */
  ensureAnchor?: (project: string) => Promise<unknown> | void;
}

export type ImpactedBaseGatePlan =
  | { mode: 'impacted'; anchor: string; tests: string[]; candidateCount: number }
  | { mode: 'full'; reason: string };

/** True iff a stored verdict row was itself measured on an impacted SUBSET (it carries the
 *  `impactedBase` marker in its resultJson). Such a PASS may be served to leaves — that is
 *  the whole point — but it must NEVER anchor a further impacted run: impacted-on-impacted
 *  chains accumulate blind spots, so anchors must be full-suite greens. A null/corrupt
 *  resultJson also refuses anchor duty (we cannot PROVE it was full-suite). */
export function isFullSuiteAnchorVerdict(row: BaseGateVerdictRow): boolean {
  if (row.status !== 'pass' || row.resultJson == null) return false;
  try {
    const r = JSON.parse(row.resultJson) as LeafGateResult;
    if (!r || typeof r !== 'object' || r.status !== 'pass') return false;
    return r.impactedBase === undefined;
  } catch {
    return false;
  }
}

const short = (sha: string): string => sha.slice(0, 8);

/** Fire-and-forget the anchor producer on an anchor-lookup MISS. The CURRENT gate still
 *  runs full (that is correct — nothing to anchor on yet); this just makes sure the anchor
 *  exists for the next asker instead of waiting for luck. Never throws, never blocks. */
function fireEnsureAnchor(opts: ImpactedBaseGateOpts): void {
  try {
    const fire = opts.ensureAnchor
      ?? ((p: string) => import('./trunk-anchor.js').then((m) => { void m.ensureTrunkAnchor(p); }));
    void Promise.resolve(fire(opts.project)).catch(() => { /* fire-and-forget */ });
  } catch { /* fire-and-forget */ }
}

/**
 * Decide impacted vs full for one base-gate run of base sha B in worktree `cwd`.
 * Never throws; every failure path returns `{ mode: 'full', reason }`.
 */
export async function planImpactedBaseGate(
  cwd: string,
  cfg: LeafGateConfig,
  opts: ImpactedBaseGateOpts,
): Promise<ImpactedBaseGatePlan> {
  const full = (reason: string): ImpactedBaseGatePlan => ({ mode: 'full', reason });
  try {
    const laneCommands = [
      ...(cfg.suites ?? []).map((l) => l.command),
      ...(cfg.floors ?? []).map((l) => l.command),
      ...(cfg.baseTest ? [cfg.baseTest] : []),
    ];
    if (!laneCommands.some((c) => BASE_FILES_CAPABLE_RE.test(c))) {
      return full('no base lane command supports --files');
    }

    const runGit = opts.runGit ?? defaultGitRunner;
    // Trunk sha M reachable from B: merge-base of B and the resolved trunk ref.
    const trunkRef = await resolveTrunkRef(cwd, runGit);
    const mb = await runGit(cwd, ['merge-base', opts.baseSha, trunkRef]);
    const anchor = mb.code === 0 ? mb.stdout.trim() : '';
    if (!anchor) return full(`cannot resolve trunk anchor (merge-base ${short(opts.baseSha)} ${trunkRef})`);

    // Green anchor: a stored PASS for (project, M, SAME lane signature, SAME quarantine
    // hash) that was measured on the FULL suite. See isFullSuiteAnchorVerdict for why an
    // impacted-measured PASS is refused here.
    const getVerdict = opts.getVerdict ?? getBaseGateVerdict;
    const key = sharedVerdictKey(baseGateKey(opts.project, anchor, cfg), opts.quarantineHash);
    const stored = getVerdict(key);
    if (!stored || stored.status !== 'pass') {
      fireEnsureAnchor(opts);
      return full(`no green anchor for trunk ${short(anchor)}`);
    }
    if (!isFullSuiteAnchorVerdict(stored)) {
      fireEnsureAnchor(opts);
      return full(`anchor ${short(anchor)} verdict is not a full-suite green (impacted or unprovable) — anchors must be full-suite`);
    }

    const diff = await runGit(cwd, ['diff', '--name-only', '--diff-filter=d', `${anchor}..${opts.baseSha}`]);
    if (diff.code !== 0) return full(`git diff ${short(anchor)}..${short(opts.baseSha)} failed`);
    const changedFiles = diff.stdout.split('\n').map((s) => s.trim()).filter(Boolean);

    const planner = opts.planner ?? planImpactedFloor;
    let plan: FloorPlan;
    try {
      plan = planner({ repoRoot: cwd, changedFiles });
    } catch (e) {
      return full(`planner threw: ${(e as Error).message}`);
    }
    if (plan.mode !== 'impacted' || !plan.tests) {
      return full(plan.trigger ?? 'planner fell back to full');
    }
    return { mode: 'impacted', anchor, tests: plan.tests, candidateCount: plan.candidateCount };
  } catch (e) {
    return full(`impacted base planning failed: ${(e as Error).message}`);
  }
}

/** Narrow a base-gate config to the impacted set: every suites[]/floors[]/baseTest lane
 *  whose command matches BASE_FILES_CAPABLE_RE gets ` --files=<impacted>` appended; with an
 *  EMPTY impacted set the lane is dropped entirely (running the runner with an empty
 *  --files list exits 1 "no files"). Typecheck lanes and non-capable commands are kept
 *  verbatim — narrowing never touches what it cannot prove is a file-scoped runner. */
export function narrowBaseGateConfig(cfg: LeafGateConfig, tests: string[]): LeafGateConfig {
  const files = tests.join(',');
  const narrowCmd = (command: string): string | null => {
    if (!BASE_FILES_CAPABLE_RE.test(command)) return command;
    if (tests.length === 0) return null; // nothing impacted — skip the lane
    return `${command} --files=${files}`;
  };
  const narrowLanes = <T extends { command: string }>(lanes: T[] | undefined): T[] | undefined => {
    if (!lanes) return lanes;
    const out: T[] = [];
    for (const lane of lanes) {
      const c = narrowCmd(lane.command);
      if (c !== null) out.push(c === lane.command ? lane : { ...lane, command: c });
    }
    return out.length > 0 ? out : undefined;
  };
  const baseTest = cfg.baseTest ? narrowCmd(cfg.baseTest) : undefined;
  return {
    ...cfg,
    suites: narrowLanes(cfg.suites),
    floors: narrowLanes(cfg.floors),
    baseTest: baseTest === null ? undefined : baseTest,
  };
}
