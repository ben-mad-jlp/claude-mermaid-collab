/**
 * MINIMAL leaf-executor (PAW P2) — the deterministic FLOOR.
 *
 * Drives ONE leaf todo through an automated blueprint→implement→review loop by
 * chaining the P1 headless node primitive (`invokeNode`), reusing the EXISTING
 * worktree-manager (fresh worktree off the epic tip) and the EXISTING completion
 * funnel (`handleWorkerComplete`) as the acceptance gate. There are NO waves, NO
 * inner task graph, and NO surgical reuse — those are P5/P6. Each node is a single
 * shot. This is the SOLE worker path (P7): the legacy tmux launch lane and its
 * LEAF_EXECUTOR env gate have been retired — the executor is always-on.
 *
 * Three hard ceilings, all explicit:
 *   1. attempt cap = 2          (ATTEMPT_CAP)
 *   2. master node budget = 20  (NODE_BUDGET — counts EVERY node across all attempts)
 *   3. fresh worktree every attempt (wm.ensure(..., { fresh: true }))
 *
 * Everything externally-effectful (the node invoker, the worktree manager, the
 * completion gate, escalation, the ledger, and the auth guard) is dependency-
 * injected via `deps` so the state machine is unit-testable with pure mocks — the
 * executor is NEVER run against a live leaf in tests.
 */

import { join, isAbsolute } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Todo } from './todo-store';
import { splitLeafInto, getTodo } from './todo-store';
import type { LeafSplitItem, LeafSplitDecision } from './split-decision';
import { type OrchestrationNodeKind, ORCHESTRATION_NODE_KINDS } from './node-kinds';
import { parseSplitDecision, topoSortSplitItems, sliceCoversFiles } from './split-decision';
import {
  parseVerdict, parseVerifyGate, parseSizeManifest, joinReviewReports,
  VERIFY_GATE_MCP_SERVER, verbMcpTool, VERIFY_GATE_MCP_TOOL, resolveVerifyGate,
} from './leaf-parsing';
import type {
  ReviewLens, LeafSizeManifest, LeafReviewVerdict, ReviewPassResult, VerifyGateVerdict, VerifyGateConfig,
} from './leaf-parsing';
import type { NodeInvoker, NodeResult, NodeSpec, AuthMode } from '../agent/node-invoker';
import type { EffortLevel } from '../agent/contracts';
import { getProjectEffort, listNodeProfileOverrides } from './orchestrator-config';
import type { WorktreeManager, ReintegrateBaseResult } from '../agent/worktree-manager';
import { ClaudeNodeInvoker, GrokNodeInvoker, assertSubscriptionAuth, assertGrokAuth, mcpConfigFor, classifyWorktreeAddFault, transientRetryAfterMs } from '../agent/node-invoker';
import { XaiApiNodeInvoker, assertXaiApiAuth } from '../agent/xai-api-invoker';
import { config } from '../config';
import { resolveNodeProvider, grokNeededForKinds, xaiApiNeededForKinds, grokModelForKind, xaiApiLedgerModel, resolveNodeModel } from './node-provider';
import { getWorktreeManager, resolveEpicId, makeCoordinatorDeps } from './coordinator-live';
import { handleWorkerComplete } from './coordinator-daemon';
import { createEscalation, resolveEscalation } from './supervisor-store';
import { composeInjectedContext, type PriorRunInput } from './prompt-injection';
import { getInjectionFlags } from './runtime-config';
import { getActiveConstraints } from './decision-record-store';
import { LeafAborted, leafAbortReason, type AbortReason } from './leaf-abort';
import { collectDiffRisk, routeReviewDepth, type ReviewDepth, type DiffRisk } from './review-depth-router';
import { proposeSplit, awaitSplitDecision, raisedNodeBudget, proposeContested, awaitContestedDecision } from './split-proposal';
import { recordNode, setLeafInflight, clearLeafInflight, recordLeafResume, markLeafMerged, getLatestSuccessfulNodeOutput, getLeafResume, clearLeafResume, getEpicBaseGate, recordEpicBaseLane, getEpicBaseLane, recordLeafBlueprint, getLeafBlueprint, clearLeafBlueprint, recordLeafResumeDecision, restoreEditableBlueprint, leafSpecSignature } from './worker-ledger';
import { scopeFailureToChangeSet, isInChangeSet, lastLines, extractFailingTests } from './gate-runner';
import { COMPILE_CHECK_INSTRUCTION } from './compile-gate';
import { snapshotMainCheckout, sweepLeakedWrites, reclaimPreDirtyScopeOverlap, type RootSnapshot } from './worktree-write-leak';
import { recordFriction } from './friction-store';
import { resolveNodePermissionMode } from './node-permission-mode';
import { stageUntrackedIntentToAdd } from './stage-untracked';
import { composeVerdict, defaultGateSpawn, runLeafGate, runBaseGate, gateFindingsText, resolveGateDeclaration, gateResultForDeclaration, isCacheableBaseGateStatus, resolveBaseGreen, escalateLegacyGateResidual, formatGateErrorReason, type LeafGateResult, type LeafGateConfig } from './leaf-gate';
export { isCacheableBaseGateStatus, resolveBaseGreen, escalateLegacyGateResidual, formatGateErrorReason } from './leaf-gate';
export { parseVerdict, parseVerifyGate, parseSizeManifest, joinReviewReports, VERIFY_GATE_MCP_SERVER, verbMcpTool, VERIFY_GATE_MCP_TOOL, resolveVerifyGate };
export type {
  LeafReviewVerdict, ReviewPassResult, VerifyGateVerdict, LeafSizeManifest, ReviewLens, VerifyGateConfig,
} from './leaf-parsing';
export { NODE_KIND_DESCRIPTIONS, MATRIX_HIDDEN_NODE_KINDS, LEAF_NODE_GROUPS, leafSessionKey };
export type { LeafNodeGroup } from './leaf-prompts';
import { validateReviewGrounding, checkConstraintCitations, extractCitations } from './review-citations';
import { detectWorkingRootEscape, evaluateCommandEvidence, parseVerificationClaims, type RecordedCommand } from './node-commands';
import { parseDiffContract, validateContractForKind } from './diff-contract';
import { validateCriteriaCitability, uncitedCriteriaAreAllCommandResults } from './criteria-citability';
import { proseGateDisposition, synthProseFindings } from './prose-gate-retry';
import { recordGateEval, type RecordGateEvalInput } from './replay-corpus-store';
import { BLUEPRINT_OUTPUT_TOKEN_CAP } from './harness-caps';
import { loadManifestSource, type ManifestSource } from '../config/project-manifest';
import { listUntrackedPaths, parseDeclaredScope, trackedDirtyPaths, stageAndCommitScoped } from './leaf-commit-scope';
import { ScopeIncidentError } from '../agent/worktree-manager';
import { sameReviewWall, isHardWall, type WallReasonClass, type LeafWallHistory, getLeafWallHistory } from './leaf-wall-history';
import { planTierEscalation, type TierEscalationPlan } from './tier-escalation';
import { isLightPathParityMet } from './review-depth-parity';

/** Friction 6150b497 default salvage-commit: stage + commit the given dirty/untracked
 *  paths in the leaf worktree via the SAME scoped-commit helper the worker merge path
 *  uses (`stageAndCommitScoped`), so the salvage commit lands on the leaf's branch
 *  exactly like a worker commit. Returns the sha, or null on failure (caller falls back
 *  to the unsalvaged empty-diff classification). */
async function salvageCommitDefault(cwd: string, message: string, paths: string[]): Promise<{ sha?: string } | null> {
  const run = async (args: string[]) => {
    try {
      const proc = Bun.spawn(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code: code ?? 1, stdout: stdout ?? '', stderr: stderr ?? '' };
    } catch {
      return { code: 1, stdout: '', stderr: '' };
    }
  };
  try {
    const out = await stageAndCommitScoped(run, { stage: paths, outOfScope: [], message });
    const sha = out.commits.at(-1)?.sha;
    return sha ? { sha } : null;
  } catch {
    return null;
  }
}

/** Hard cap on the own-prior-work git probe (same bound the other daemon-resident git
 *  probes use). A `git log --grep` over one branch range is milliseconds; the cap only
 *  exists so a pathological repo can never pin the sidecar. */
const OWN_WORK_PROBE_TIMEOUT_MS = 15_000;

/** Default {@link LeafExecutorDeps.ownWorkCommitOnEpicBranch}: does the EPIC branch's own
 *  history (`<baseBranch>..refs/heads/<epicBranch>` — commits reachable from the epic tip but
 *  NOT from trunk, so an unrelated branch's commit can never satisfy the check) contain a
 *  commit carrying this leaf's `Collab-Todo: <leafId>` trailer? Returns the newest such sha, or
 *  null. FAIL CLOSED: any git error, non-zero exit, missing ref, or absent epic branch reads as
 *  null (the caller keeps the legacy escalate+park). ASYNC bounded spawn (Bun.spawn + await
 *  exited + kill timer) — NEVER spawnSync: this runs in the sidecar process (crit-6, mission
 *  693bbc27; see `runBounded` in verify-epic.ts). Exported for test. */
export async function findOwnWorkCommitOnEpicBranch(
  projectRoot: string,
  input: { leafId: string; epicBranch: string; baseBranch: string },
): Promise<{ sha: string } | null> {
  const { leafId, epicBranch, baseBranch } = input;
  if (!projectRoot || !leafId || !epicBranch || !baseBranch) return null;
  // No epic accumulation branch (the leaf builds straight off trunk) ⇒ there is no
  // epic-scoped range to search ⇒ INDETERMINATE, not negative. Fail closed.
  if (epicBranch === baseBranch) return null;
  try {
    const proc = Bun.spawn(
      [
        'git', '-C', projectRoot, 'log', '--format=%H', '-1', '--fixed-strings',
        `--grep=Collab-Todo: ${leafId}`,
        `${baseBranch}..refs/heads/${epicBranch}`,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const killTimer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, OWN_WORK_PROBE_TIMEOUT_MS);
    try {
      const [stdout, code] = await Promise.all([
        proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(''),
        proc.exited,
      ]);
      if (code !== 0) return null;
      const sha = (stdout ?? '').trim().split('\n')[0]?.trim() ?? '';
      return sha ? { sha } : null;
    } finally {
      clearTimeout(killTimer);
    }
  } catch {
    return null;
  }
}

/** G3 worktree-existence predicate for review citations (retained-code tolerance).
 *  Bounded to the lane worktree: rejects absolute paths and `..` segments outright, then
 *  checks the cited file exists under `root` with at least `line` lines. Per-run cache —
 *  a review cites a handful of files, each read at most once. Exported for test. */
export function makeCitationExists(root: string): (path: string, line: number) => boolean {
  const lineCount = new Map<string, number>(); // path → line count, -1 = missing/unreadable
  return (path: string, line: number): boolean => {
    if (!path || isAbsolute(path) || path.split('/').includes('..')) return false;
    let n = lineCount.get(path);
    if (n === undefined) {
      try {
        n = readFileSync(join(root, path), 'utf8').split('\n').length;
      } catch {
        n = -1;
      }
      lineCount.set(path, n);
    }
    return n >= 0 && line >= 1 && line <= n;
  };
}

/** LeafTier 'test-pinned' CODE-level immutability predicate: which declared-scope paths
 *  are the pinned executable spec (design-grok-worker-discipline §2.3, TestSpecSchema —
 *  "authored as the spec … must NOT weaken"). Pure; exported for test. */
export function isTestPinnedPath(path: string): boolean {
  return /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.[A-Za-z0-9]+$/.test(path);
}

/** sha256 of each file's on-disk content under `cwd`, keyed by its declared (relative)
 *  path. A missing/unreadable file hashes to null — that is a legitimate baseline state
 *  (nothing pinned yet), never a throw. Pure I/O helper; exported for test. */
export function hashPinnedFiles(cwd: string, files: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of files) {
    try {
      out[f] = createHash('sha256').update(readFileSync(join(cwd, f))).digest('hex');
    } catch {
      out[f] = null;
    }
  }
  return out;
}

/** Diff two {@link hashPinnedFiles} snapshots of the SAME key set and return the paths
 *  whose content changed. A file with no baseline hash (didn't exist yet) is never a
 *  violation — only an EXISTING pinned test can be weakened. Pure; exported for test. */
export function testPinViolations(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): string[] {
  const violations: string[] = [];
  for (const [file, beforeHash] of Object.entries(before)) {
    if (beforeHash === null) continue;
    if (after[file] !== beforeHash) violations.push(file);
  }
  return violations;
}

/** RETRY MODEL LADDER: a fresh attempt after a review FAIL re-runs implement one tier UP
 *  (haiku→sonnet, sonnet→opus) instead of rolling the same dice twice — the leaf that
 *  needed it: 6d67a801 burned 7 review cycles on haiku for executor control-flow surgery.
 *  Non-Claude lanes (grok-*, composer-*) and already-opus never ladder; attempt 1 never
 *  ladders (per-kind pins stay authoritative for the first try). Pure; exported for test. */
export function escalateImplementModel(model: string, attempt: number): string {
  if (attempt < 2) return model;
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 'sonnet';
  if (m.includes('sonnet')) return 'opus';
  return model;
}

/** crit 1 — NON-falsifiable review DOUBT detector. A review FAIL that expresses INABILITY to
 *  assess ("can't confirm correctness", "nothing to review", "not enough context") rather than
 *  asserting a concrete defect is non-falsifiable DOUBT — over a green mechanical gate it is an
 *  ABSTAIN, not a gating finding (the exact shape of the observed executor-core over-rejections:
 *  "[N/A] … nothing to review", "can't confirm"). This is deliberately NARROW: a bare fault
 *  claim ("VERDICT: FAIL — missing null check" / "— real fault") is NOT doubt and STILL gates.
 *  An empty finding is pure doubt. v1 heuristic — tunable via the replay corpus. Exported for test. */
const NON_FALSIFIABLE_DOUBT_RE = new RegExp(
  [
    "(can'?not|can'?t|couldn'?t|unable to|not able to|hard to|difficult to)\\s+(confirm|verify|assess|determine|tell|be sure|establish|ascertain|validate|evaluate|review|judge)",
    "nothing\\b[^.\\n]{0,40}?\\bto review",
    "no (?:changes?|code|diff|edits?)\\b[^.\\n]{0,40}?\\bto review",
    "not enough (?:context|information|detail|evidence)",
    "insufficient (?:context|information|evidence|detail)",
    "without (?:more|additional|further) (?:context|information)",
  ].join('|'),
  'i',
);

/** crit 1 (v2) — a CONCRETE, FALSIFIABLE DEFECT assertion. When a clause asserts one of these
 *  faults it is checkable at a `file:line` — NOT doubt — so it STILL gates even if the finding
 *  ALSO hedges elsewhere ("...I can't verify the retry path"). Deliberately HIGH-PRECISION: it
 *  fires only on unambiguous fault vocabulary (a false positive here re-gates a green change, the
 *  very over-rejection we are reducing), so weak signals ("should be", "returns X") are omitted —
 *  a finding with no doubt phrase already gates via the fall-through, without needing this list. */
const CONCRETE_DEFECT_RE = new RegExp(
  [
    // omission of a required action
    "\\bmissing\\b",
    "\\bnot (?:await(?:ed)?|closed|released|freed|handled|implemented|sanitized|sanitised|escaped|validated|checked|guarded|bound)\\b",
    "\\bnever (?:await(?:ed)?|closed|freed|called|released)\\b",
    "\\b(?:un|not )implemented\\b|\\bstill a stub\\b|\\bleft as a stub\\b|\\bTODO\\b",
    // wrong value / logic
    "\\binstead of\\b|\\brather than\\b",
    "off.?by.?one|\\bone past\\b|out of bounds|out-of-bounds|\\boverrun\\b",
    "sign (?:error|flip)|\\bflipped\\b|wrong (?:value|result|default|sign|order|branch|condition)",
    // classic bug classes
    "\\boverflow\\b|\\bunderflow\\b|injection|\\bleak(?:s|ed|ing)?\\b|race condition|\\bdeadlock\\b|use.after.free",
    "null pointer|\\bnpe\\b|segfault|\\bpanics?\\b|\\bpanicked\\b|\\bthrows\\b|\\bNaN\\b|divi(?:de|sion) by zero",
    // shared / aliased state
    "shared (?:across|state)|mutated in place|\\baliase[sd]\\b|\\baliasing\\b",
  ].join('|'),
  'i',
);

/** Split a finding into clauses on sentence/clause boundaries. A period only splits when it ends
 *  a sentence (followed by whitespace or end) so `save.ts:3` / `1.0` stay intact. */
function splitReviewClauses(t: string): string[] {
  return t.split(/(?:\.\s+|\.$|[;\n]+|\s[—–-]\s)/).map((c) => c.trim()).filter(Boolean);
}

export function isNonFalsifiableReviewDoubt(reviewText: string): boolean {
  // Strip the VERDICT sentinel AND a residual reason-separator (a bare "VERDICT: FAIL —" leaves
  // an em-dash that must not read as a non-empty concrete finding). An empty residual = pure doubt.
  const t = (reviewText ?? '')
    .replace(/verdict:\s*(pass|fail)/gi, '')
    .replace(/^[\s—–\-.:,]+|[\s—–\-.:,]+$/g, '')
    .trim();
  if (!t) return true; // an empty finding is pure doubt, never a falsifiable defect
  // A concrete defect asserted in ANY clause that is not itself hedged by doubt gates the change —
  // even when a SEPARATE clause hedges. This is the mixed "concrete + incidental can't-verify" shape
  // that a whole-text doubt scan wrongly abstained (shipping the real defect). When a single clause
  // entangles both, we stay conservative (treat as doubt → do not gate → no over-rejection).
  for (const clause of splitReviewClauses(t)) {
    if (CONCRETE_DEFECT_RE.test(clause) && !NON_FALSIFIABLE_DOUBT_RE.test(clause)) return false;
  }
  // No concrete defect clause: doubt iff a doubt phrase is present anywhere (v1 behavior preserved).
  return NON_FALSIFIABLE_DOUBT_RE.test(t);
}

/** crit 2 — a declared TEST file (the coverage signal runs these against the base impl). */
const TEST_FILE_RE = /(?:\.|_)(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|test|tests|spec)\//i;
export function isTestFilePath(path: string): boolean {
  return TEST_FILE_RE.test(path ?? '');
}

/** SAME-WALL detector: are two review findings substantially the SAME findings?
 *  Line-set overlap after normalization (lowercase, digits→# so shifted line numbers
 *  don't defeat the match, short/empty lines dropped) ≥ 0.5 of the smaller set.
 *  Used (a) inside the revise loop — the old exact-equality isRepeat missed findings
 *  that drift textually while saying the same thing, and (b) across fresh attempts —
 *  a repeat wall parks with a reason that names the FORK (stronger tier / new-todo
 *  re-spec / hand-build) instead of a generic cap-exhausted. Pure; exported for test.
 *
 *  The "wall" is the set of UNRESOLVED defect lines (UNMET / FAIL / the failing reason) — NOT
 *  the whole review. Passing `[MET]`/`[N/A]` criteria and boilerplate preamble ("## CRITERIA",
 *  "Reviewed the working tree…") are STABLE across attempts, so including them inflates the
 *  overlap into a FALSE repeat: two attempts that fail for DIFFERENT reasons (real progress —
 *  one defect fixed, a new one surfaced) then read as "same wall" and PARK PREMATURELY, giving
 *  up on still-fixable work. So we compare only the defect lines, falling back to all lines for
 *  a free-form finding that carries no explicit UNMET/FAIL marker. (A fully-paraphrased SAME
 *  defect with no shared line still evades line-overlap — that residual miss is bounded by the
 *  revise cap + node budget, not an infinite thrash.) */
export { sameReviewWall } from './leaf-wall-history';

export type { LeafNodeKind } from './leaf-prompts';

// Re-export types so they're available to users of leaf-executor.ts
export type { LeafSplitItem, LeafSplitDecision } from './split-decision';

export {
  type OrchestrationNodeKind,
  ORCHESTRATION_NODE_KINDS,
  ORCHESTRATION_NODE_PROFILE,
  ORCHESTRATION_NODE_DESCRIPTIONS,
} from './node-kinds';

/** Dependency seam — defaults wire the real implementations; tests inject mocks. */
export interface LeafExecutorDeps {
  /** Node invoker. Default `ClaudeNodeInvoker` (real `claude -p`). */
  invoker: NodeInvoker;
  /** Grok node invoker (real `grok -p`) — used per-node when a kind routes to grok-build.
   *  Default `GrokNodeInvoker`. */
  grokInvoker?: NodeInvoker;
  /** xAI-API node invoker (grok-4.3 read-only loop) — used per-node when a kind routes to
   *  grok-api. Default `XaiApiNodeInvoker`. */
  xaiInvoker?: NodeInvoker;
  /** Grok auth assertion — pre-flighted at leaf entry when any node may run on grok, so a
   *  mixed leaf fails fast instead of stranding after the cheap grok work. Default
   *  `assertGrokAuth`. */
  assertGrokAuth?: () => AuthMode | Promise<AuthMode>;
  /** xAI-API auth assertion (XAI_API_KEY) — pre-flighted at leaf entry when any node routes to
   *  grok-api. Default `assertXaiApiAuth`. */
  assertXaiApiAuth?: () => AuthMode | Promise<AuthMode>;
  /** Worktree manager for the TARGET repo. */
  wm: WorktreeManager;
  /** The epic id this leaf rolls up to (per-epic accumulation branch). */
  epicId: string;
  /** The epic's accumulation branch (worktrees are cut fresh off its tip). */
  epicBranch: string;
  /** The repo's TRUNK branch (what the epic branch was cut off, and what the review
   *  pipeline diffs the union change-set against). Detected at deps-construction via
   *  the worktree manager's git-HEAD probe (see `detectBaseBranch` in worktree-manager.ts)
   *  so a non-master-trunk project doesn't silently diff against a nonexistent 'master'.
   *  Default `'master'` (legacy behaviour) when a caller doesn't thread it. */
  baseBranch?: string;
  /** Epic tip SHA at run start — recorded into the durable resume row so a later
   *  re-claim can detect a moved base (slice 2). Best-effort; may be null. */
  epicBaseSha?: string | null;
  /** The TARGET repo's MAIN checkout (the leaf's tracking root). Threaded ONLY so node
   *  prompts and the working-root guard can NAME it — the executor resolves no paths from
   *  it. Unwired ⇒ prompts state the worktree alone (still the fix's load-bearing half). */
  mainCheckoutRoot?: string;
  /** Once-per-run subscription auth assertion (throws if not the subscription).
   *  May be async — the REAL assertion spawns `claude auth status` and must never
   *  block the sidecar event loop (crit-6, mission 693bbc27). */
  assertAuth: () => AuthMode | Promise<AuthMode>;
  /** Route a PASS/BLOCKED proposal through the EXISTING completion gate funnel.
   *  Returns the gate's authoritative effective outcome. */
  complete: (
    project: string,
    todoId: string,
    acceptance: 'accepted' | 'rejected',
  ) => Promise<{
    effective?: 'accepted' | 'rejected' | 'pending';
    /** Why the gate downgraded 'accepted'→'pending' (work-committed re-verify). Carried
     *  through so the terminal record can explain a pending, instead of dropping it. */
    pendingReason?: string;
    /** When the gate overrode 'accepted'→'rejected', the failing-gate reasons. */
    gateReasons?: string[];
  }>;
  /** Commit the leaf worktree + merge it back onto the epic branch (so the gate's
   *  work-committed re-verify sees it). Called on PASS, BEFORE `complete`. */
  mergeToEpic: (
    sessionKey: string,
    epicId: string,
    message: string,
    todoId: string,
    scope?: { declaredFiles: string[]; untrackedAtStart: string[] },
  ) => Promise<unknown>;
  /** crit 6 auto-revert seam: undo ONE optimistically-landed leaf's merge commit on the
   *  epic branch when its POST-merge review returned a real FAIL. Reverts only THIS leaf's
   *  merge (mainline-parent revert), leaving prior/subsequent epic commits intact. Best-effort
   *  (`?.`): unwired ⇒ the optimistic path is never taken (small/test-pinned tiers only wire it
   *  in the factory), so the floor/tests behave exactly as the pre-crit-6 pipeline. */
  revertEpicMerge?: (
    sessionKey: string,
    epicId: string,
    leafId: string,
    mergeSha: string,
    reason: string,
  ) => Promise<{ reverted: boolean; revertSha?: string; error?: string; verified?: boolean }>;
  /** Rebase-continue seam: resume a lane worktree and reintegrate a moved epic base into it.
   *  Called on the first attempt of a rebase-continue run when the implement phase already
   *  completed against an old base. Best-effort (`?.`): unwired ⇒ falls through to fresh-fork
   *  fallback (existing behaviour). */
  reintegrateBase?: (sessionId: string, baseBranch: string) => Promise<ReintegrateBaseResult>;
  /** Raise an escalation card (blocker). */
  escalate: (input: {
    project: string;
    session: string;
    kind: string;
    todoId?: string | null;
    questionText: string;
  }) => void;
  /** SR-3: raise/find the ONE open split proposal for this leaf. Never materializes children.
   *  Default → `proposeSplit`. Unwired (`?.`) ⇒ the caller skips straight to the FLOOR. */
  proposeSplit?: (input: {
    project: string;
    session: string;
    leaf: { id: string; title?: string | null };
    itemCount: number;
    reason: string;
  }) => { escalationId: string; createdAt: number; isNew: boolean };
  /** SR-3: bounded wait for the proposal's answer. Default → `awaitSplitDecision`. */
  awaitSplitDecision?: (input: {
    escalationId: string;
    createdAt: number;
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    readDecision?: (id: string) => { optionId: string | null } | null;
  }) => Promise<'split' | 'linear' | 'timeout'>;
  /** SR-3: close the proposal card once the run has acted on it. Default → `resolveEscalation`. */
  resolveProposal?: (escalationId: string, status: string, resolvedBy?: 'ai' | 'human') => void;
  /** crit 4: raise a bounded-wait CONTESTED-ACCEPT decision card for a GREEN-mechanical change
   *  whose falsifiable review FAIL is UNCOVERED and same-walled — instead of a silent park.
   *  Default → `proposeContested`. Unwired ⇒ the caller falls straight through to today's park. */
  proposeContested?: (input: {
    project: string;
    session: string;
    leaf: { id: string; title?: string | null };
    reason: string;
  }) => { escalationId: string; createdAt: number; isNew: boolean };
  /** crit 4: bounded wait for the contested card. 'accept' lands the change; 'reject'/'timeout'
   *  is the SAFE DEFAULT = today's park. Default → `awaitContestedDecision`. */
  awaitContestedDecision?: (input: {
    escalationId: string;
    createdAt: number;
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    readDecision?: (id: string) => { optionId: string | null } | null;
  }) => Promise<'accept' | 'reject' | 'timeout'>;
  /** Append a best-effort node-ledger row. */
  recordNode: typeof recordNode;
  /** SEAM (crit-5): persist each G3 / citability gate evaluation to the per-project
   *  replay corpus. Best-effort telemetry — unwired in tests/floor; a throw NEVER
   *  breaks the run. Called from the executor, NEVER from the pure validate* fns. */
  recordGateEval?: (project: string, input: RecordGateEvalInput) => Promise<unknown>;
  /** Per-project SHADOW MODE: when true, gate evals are still recorded but a
   *  vacuous (G3) / uncitable (citability) verdict is RECORD-ONLY — the leaf does
   *  NOT parkBlocked. abstain/error incidents are infra and are never suppressed.
   *  Default reader is () => false; the sibling harness leaf replaces the factory
   *  default with the runtime-config reader. */
  gateShadowMode?: (project: string) => boolean;
  /** LIVE in-flight signal (optional): mark/clear the leaf as running a node so separate
   *  processes (UI, MCP, daemon_status) can see "on node X, Ns elapsed". Best-effort; the
   *  floor/tests run fine unwired. */
  setInflight?: (e: { project: string; leafId: string; epicId?: string | null; nodeKind?: string | null; model?: string | null; attempt?: number | null }) => void;
  clearInflight?: (leafId: string) => void;
  /** DURABLE resume state (slice 1b): persist the budget already spent (+ phase/attempt)
   *  so a hard kill recovers it on re-claim instead of resetting the budget. Best-effort;
   *  unwired in tests. */
  persistResume?: (e: { project: string; leafId: string; nodesSpent: number; phase?: string | null; attempt?: number | null; epicBaseSha?: string | null }) => void;
  /** G8: persist the durable blueprint base SHA so a reusable blueprint survives when
   *  the run checkpoint is cleared by a terminal outcome. Best-effort; unwired in tests. */
  persistBlueprintBase?: (e: { project: string; leafId: string; epicBaseSha?: string | null; specJson?: string | null; specRev?: number | null; specSig?: string | null }) => void;
  /** Flag the leaf merged-to-epic (slice-2 reattach consumes this; recorded now). */
  markMerged?: (leafId: string) => void;
  /** FM1 Phase-B hardening: durably stamp the REJECT intent (acceptanceStatus='rejected')
   *  BEFORE the slow `complete` gate runs. parkBlocked has already decided 'rejected', so
   *  this lands the terminal marker first — then reclaimNow's rejected-guard protects the
   *  leaf from being reclaimed+re-run even if the process restarts mid-gate (the residual
   *  window inProcessLaneAlive can't cover, because a restart kills the in-process lane).
   *  Best-effort; unwired in tests/floor. Awaited so the stamp lands before the gate. */
  /** Ownership-gated reject pre-stamp. Returns TRUE if the run still owns the todo (it
   *  stamped 'rejected'), FALSE if a concurrent run already took it terminal → caller
   *  discards the blocked outcome. (void/undefined = legacy: treat as owned.) */
  markRejecting?: (project: string, leafId: string) => void | boolean | Promise<void | boolean>;
  /** Bump the leaf's retryCount so an INFRA incident (vacuous review) is visible on the
   *  graph. Ownership-gated; best-effort — never breaks the run. */
  bumpRetry?: (project: string, leafId: string) => void | boolean | Promise<void | boolean>;
  /** Refund the dispatch-time retryCount bump when zero real work happened (epic-base-moved
   *  park infra incident). Undoes {@link bumpRetry}. Ownership-gated; best-effort —
   *  never breaks the run. BOUNDED: the live wiring refunds at most
   *  MAX_BASE_MOVED_REFUNDS times per leaf (durable `baseMovedRefunds` counter). Past the
   *  bound it returns false without mutating, so retryCount accumulates to MAX_REDISPATCH
   *  and the leaf is parked by the re-dispatch cap instead of looping forever. */
  refundRetry?: (project: string, leafId: string) => void | boolean | Promise<void | boolean>;
  /** Release a claimed leaf (infra park seam). Best-effort; unwired in tests. */
  releaseClaim?: (project: string, todoId: string) => Promise<boolean | void>;
  /** Durably PARK (hold) a leaf so it is NOT re-claimed — the start-failure circuit-breaker
   *  (bug a8935a16). Called INSTEAD of releaseClaim once a leaf has already burned its one
   *  start-failure retry, so a node that can't START stops spinning through MAX_CLAIM_RETRIES.
   *  Best-effort; unwired in tests (⇒ falls back to release). */
  holdLeaf?: (project: string, todoId: string, reason: string) => Promise<boolean | void>;
  /** Resume plan for this dispatch (slice 2). Absent ⇒ a clean fresh run. */
  resumePlan?: ResumePlan;
  /** Fetch the durable blueprint plan text for a leaf (reattach reuses it in a fresh
   *  worktree instead of re-running the blueprint node). null ⇒ fall back to running it. */
  restoreBlueprint?: (leafId: string) => string | null;
  /** Master node budget override (TEST seam). Default {@link NODE_BUDGET}=20. The
   *  floor structurally spends ≤6 nodes (3/attempt × cap 2); this backstop catches a
   *  runaway node (e.g. one that internally loops). Lowerable in tests to exercise
   *  the budget ceiling deterministically without faking a 20-node run. */
  nodeBudget?: number;
  now?: () => number;
  /** Change-set seam: the files THIS leaf's worktree touched (vs the epic base),
   *  used to (1) scope the WAVES tsc gate so a PRE-EXISTING foreign error in a file
   *  the leaf never touched can't block it (matching the completion gate's contract),
   *  and (2) detect a no-op `wimplement` (file already satisfied) so its per-file verify
   *  is skipped instead of burning a node. Default → `wm.changeSet(sessionKey, epicBranch)`.
   *  Optional `?.`: when unwired (tests / non-git) it returns null and BOTH behaviours
   *  fall back to the prior conservative path (gate fails on any error; no skip). */
  changeSet?: (sessionKey: string) => Promise<string[] | null>;
  /** Salvage seam (friction 6150b497) — list DIRTY (tracked-modified) + UNTRACKED paths in
   *  the leaf worktree, so the empty-diff classifier can tell "implement did real work but
   *  never ran git commit" apart from "implement produced nothing". Default: real git via
   *  `trackedDirtyPaths` + `listUntrackedPaths` on the worktree cwd. Optional `?.` so tests
   *  can script the tree state. */
  worktreeDirty?: (cwd: string) => string[];
  /** Salvage seam (friction 6150b497) — commit ALL the given dirty/untracked paths on the
   *  leaf's branch with a standard worker-shaped message (mirrors the mergeToEpic commit:
   *  `feat: <title>` + `Collab-Todo:` trailer), exactly as if the implement node had
   *  committed. Default: real git via `stageAndCommitScoped`. Returns the commit sha, or
   *  null when nothing was committed / the commit failed (caller falls back to the
   *  unsalvaged empty-diff classification). */
  salvageCommit?: (cwd: string, message: string, paths: string[]) => Promise<{ sha?: string } | null>;
  /** Diff-risk probe feeding the review-depth router. Default `collectDiffRisk`. */
  collectDiffRisk?: (cwd: string, baseRef: string) => Promise<DiffRisk>;
  /** OWN-PRIOR-WORK probe (real incident 2026-07-24: a leaf was dispatched 11 times because
   *  its work was already committed on the epic branch by an early attempt — every re-dispatch
   *  re-ran implement, correctly produced a ZERO-FILE diff, and the empty-diff guard parked it
   *  blocked, dep-blocking the whole epic). Is a commit carrying THIS leaf's
   *  `Collab-Todo: <leafId>` trailer present in the EPIC branch's OWN history — the
   *  `<trunk>..refs/heads/<epicBranch>` range, so a commit on some unrelated branch can never
   *  satisfy it? Returns `{ sha }` only on a positive, unambiguous hit; null when absent OR
   *  indeterminate (non-git, git error, no epic accumulation branch). The caller FAILS CLOSED
   *  on null: unchanged escalate + park. Default: real git via an ASYNC bounded spawn in the
   *  target repo (never spawnSync — this runs in the sidecar event loop). */
  ownWorkCommitOnEpicBranch?: (input: {
    leafId: string;
    epicBranch: string;
    baseBranch: string;
  }) => Promise<{ sha: string } | null>;
  /** Auto-split seam. SR-6: takes structured ITEMS (each = one child leaf, >= 1 file, with
   *  sibling `dependsOn` edges), not a flat file list. A plain `string[]` is still accepted
   *  and normalised to one edgeless item per file (legacy file-count path + old tests).
   *  The leaf becomes a non-executable dependency-grouping container (sweepEpicRollups closes
   *  it when its children settle; it owns no branch and triggers no merge). Default →
   *  `splitLeafInto` in todo-store. Optional `?.`: unwired (tests / floor) ⇒ never splits. */
  splitInto?: (leaf: Todo, items: LeafSplitItem[] | string[]) => Promise<void>;
  /** P5 size-gate seam: read back the blueprint artifact (the .md the blueprint
   *  node wrote, including its trailing ```json size block) so the executor can
   *  derive the {@link LeafSizeManifest}. Default reads
   *  `path.join(cwd, blueprintPath(leaf))` via fs; tests inject the text directly.
   *  Optional `?.` keeps the floor working even if unwired (→ undefined → null
   *  manifest → FLOOR, the fail-safe default). */
  readBlueprint?: (cwd: string, leaf: Todo) => Promise<string | undefined>;
  /** Verify pipeline seam (epic f5c7fc46): read back a worktree-relative artifact (the
   *  authored plan, the verb's raw result) so the gate parses the verb's TRUE output rather
   *  than the model's prose. Default reads `path.join(cwd, relPath)` via fs; tests inject
   *  text directly. Optional `?.` keeps the code path working unwired. */
  readArtifact?: (cwd: string, relPath: string) => Promise<string | undefined>;
  /** Verify pipeline seam (epic f5c7fc46 L5): write a worktree-relative artifact from the
   *  EXECUTOR, not the node. The report node emits its markdown as its final message; the
   *  executor persists it into the leaf worktree itself, because a headless node's NEW-file
   *  Write resolves to the project ROOT (a worktree's .git points back to the main repo), not
   *  the worktree — so a node-written report never reaches mergeToEpic and the accept reverses.
   *  Default writes `path.join(cwd, relPath)` via fs (mkdir -p); tests stub it. */
  writeArtifact?: (cwd: string, relPath: string, content: string) => Promise<void>;
  /** L3 verify command-gate seam (epic f5c7fc46 e9ce8693): run a {@link VerifyGateConfig.command}
   *  shell gate (e.g. `pytest -q`) in the worktree. `ran:false` ⇒ the command could not execute
   *  (spawn error / missing tool) → INFRA failure → park blocked; `ran:true, ok:false` ⇒ the gate
   *  ran and failed → a FINDING composed into the report. Default spawns via the shell; tests
   *  inject a verdict. Optional `?.` — only invoked when a config declares a command. */
  runCommandGate?: (cwd: string, command: string) => Promise<{ ran: boolean; ok: boolean; output: string }>;
  /** L3: resolve the verify gate config (verb + optional command) for a leaf. Default
   *  {@link resolveVerifyGate}; injected in tests to exercise command-gate composition. */
  resolveVerifyGate?: (leaf: Todo) => VerifyGateConfig;
  /** G2 mechanical gate at leaf HEAD. Runs the PROJECT-DECLARED gate in the leaf worktree.
   *  'fail' ⇒ the leaf's work is bad (a FINDING). 'error' ⇒ the gate could not run (an
   *  INCIDENT → park blocked + escalate; NEVER reported as the leaf failing). Unwired ⇒
   *  undefined ⇒ no mechanical signal (pre-G2 behaviour). */
  runGate?: (cwd: string) => Promise<LeafGateResult>;
  /** crit 2 (edit-coverage): LAZILY compute whether the leaf's DECLARED test files FLIP
   *  base→branch — i.e. do those tests FAIL against the base implementation (and pass at HEAD,
   *  already proven by the green mechanical gate)? TRUE ⇒ the tests genuinely exercise the
   *  change (an independent mechanical proof it works); FALSE ⇒ the tests don't depend on it;
   *  null ⇒ could-not-determine (no base sha / no declared tests / infra error). Called ONLY
   *  from the contested green-mech point (a falsifiable FAIL), never eagerly — a base test run
   *  is ~2× cost, bounded to the contested minority. DEFENSIVE: null/false ⇒ the review still
   *  gates (advisory-accept requires a POSITIVE true). Unwired ⇒ undefined ⇒ null ⇒ gate. */
  testsFlipBaseToBranch?: (input: {
    cwd: string;
    testFiles: string[];
    baseSha?: string | null;
  }) => Promise<boolean | null>;
  /** L4 CITABILITY gate: check if a line exists at the base SHA. May be sync or async; the
   *  executor prewarms every extracted citation into a resolved Map and passes a sync reader
   *  to the validator (criteria-citability.ts:142 calls it in a plain .some() never awaited).
   *  Default async impl uses `git show` bounded at 10_000 ms via Bun.spawn; promises are
   *  memoised per-path in the per-run closure, so one path costs one spawn. Unwired ⇒
   *  undefined ⇒ returns false ⇒ base-existence acquittal never fires. */
  citationLineExistsAtBase?: (input: { cwd: string; baseSha?: string | null; path: string; line: number }) => boolean | Promise<boolean>;
  /** G2 once-per-epic base gate. Resolves the CACHED verdict for this epic, computing it on
   *  first call. `fresh` is true only on the call that actually executed the commands (so the
   *  escalation is raised once, not once per leaf). Unwired ⇒ undefined ⇒ skipped. */
  ensureBaseGreen?: () => Promise<(LeafGateResult & { fresh: boolean }) | null>;
  /** Reader for the leaf's parent-epic todo row — consulted by the G2 base-red park to
   *  honor the epic-level `baseRepair` exemption (bug 65345589). Defaults to
   *  getTodo(project, leaf.parentId); injectable for tests. */
  getEpicTodo?: () => Todo | null;
  /** Injectable node-profile override map (kind → {model,effort,provider}); defaults to
   *  listNodeProfileOverrides(project). Tier-scoped keys like 'implement@small' beat the
   *  kind-wide key for leaves of that tier. Injectable for tests (the real store is the
   *  global supervisor DB, off-limits to hermetic tests). */
  nodeProfileOverrides?: ReturnType<typeof listNodeProfileOverrides>;
  /** Injectable cross-dispatch wall history; unwired ⇒ `getLeafWallHistory(leaf.id)`
   *  (keeps hermetic tests off the global ledger DB). */
  wallHistory?: LeafWallHistory;
  /** Floor-path base-freshness pre-check (real incident: a stale/off-by-one base spent
   *  blueprint+implement+review before being rejected at the gate for tsc errors in files it
   *  never touched — thrash discovered late). Cheap deterministic git probe: is the epic
   *  branch's (or trunk's, when no epic) CURRENT tip still an ancestor of the lane worktree's
   *  HEAD, run inside `cwd`? true ⇒ fresh; false ⇒ the tip moved past this worktree's fork
   *  point — STALE, park before spending any node; null ⇒ the probe could not determine it
   *  (non-git / git error) — fail-open (never park a healthy leaf on a broken probe). Unwired
   *  ⇒ undefined ⇒ skipped (pre-existing behaviour). */
  worktreeBaseFresh?: (cwd: string) => Promise<boolean | null>;
  /** Persist the just-written blueprint as a durable collab document and link it to
   *  the leaf todo (per ATTEMPT, so failed attempts survive). Best-effort: a throw
   *  must NEVER break the run. Returns the created doc id (telemetry only). Optional
   *  `?.` keeps the floor running if unwired. */
  persistBlueprint?: (input: {
    project: string;          // TRACKING project (where the todo lives) — NOT the worktree
    leaf: Todo;
    attempt: number;          // 1-based; included in doc name + body so attempts are distinct
    manifest: LeafSizeManifest;
    blueprintMd: string;      // the full .md text (prose + trailing json fence)
  }) => Promise<string | undefined>;
  /** Resume seam (P3): seed `state.nodesSpent` so total spawns across all
   *  pause/resume cycles stay bounded by the master {@link NODE_BUDGET}. The daemon
   *  (headless-breaker) carries the paused leaf's prior `nodesSpent` in here on
   *  re-dispatch. Defaults 0 (a fresh, never-paused leaf). */
  startNodesSpent?: number;
  /** Return a non-null reason to stop the run at the next node boundary (ancestor drop,
   *  hold, or claim loss). Checked before AND after every node spawn so a between-nodes
   *  kill turns into a clean 'aborted' return instead of the next node being spawned.
   *  Optional `?.` — unwired (tests / legacy dispatch) ⇒ never aborts. */
  shouldAbort?: (project: string, leafId: string) => AbortReason;
  /** Clear the durable resume row on abort — `finishWith` owns it (a hard kill/throw
   *  never reaches the daemon's own `clearLeafResume` call). Best-effort. */
  clearResume?: (leafId: string) => void;
}

export interface LeafRunResult {
  // 'pending' is a FIRST-CLASS outcome (no longer collapsed into 'rejected'): the
  // review PASSed and the work merged, but the completion gate's work-committed
  // re-verify deferred. Distinct from 'rejected' (gate/review actually failed).
  // 'split' (SR-3): an explicit 'split' answer was given to a proposal, and children
  // were materialized. The leaf became a non-executable dependency-grouping container.
  // No completion, no merge — sweepEpicRollups closes it when its children settle;
  // the enclosing epic's LAND leaf stays the merge authority. The coordinator treats it
  // as "this dispatch produced no acceptance" (returns false); the container claim-guard
  // then keeps the parent from being re-claimed.
  // 'aborted': the daemon stopped the run at a node boundary (ancestor drop, hold, or
  // claim loss) — the todo's terminal state was already set by whoever aborted it; the
  // executor does NO completion, merge, or escalation of its own on this outcome.
  outcome: 'accepted' | 'rejected' | 'pending' | 'blocked' | 'paused' | 'split' | 'aborted';
  attempts: number;
  nodesSpent: number;
  /** Set on a 'blocked' outcome (the cap/budget reason). */
  reason?: string;
  /** Present ONLY when outcome==='paused' (a node hit a rate cap). The minimum the
   *  daemon needs to resume — the executor NEVER backs off; it just yields this. */
  paused?: {
    /** the node kind that hit the cap. */
    atNode: LeafNodeKind;
    /** 1-based attempt in flight when paused (preserved — pause does NOT burn it). */
    attempt: number;
    /** budget already consumed (carried across resume via startNodesSpent). */
    nodesSpent: number;
    /** epoch ms the cap is known to reset, if the CLI surfaced one (else undefined →
     *  daemon uses pure backoff). */
    capReset?: number;
  };
}

export interface LeafRunContext {
  project: string;
  leaf: Todo;
  deps: LeafExecutorDeps;
  epicId: string;
  epicBranch: string;
  sessionKey: string;
  state: { attempt: number; nodesSpent: number; pathTaken: 'floor' | 'waves' | 'review' | null };
  budgetState: { value: number; raises: number };
  escalatedKinds: Set<LeafNodeKind>;
  checkBudget: () => boolean;
  runNode: (kind: LeafNodeKind, spec: NodeSpec, extra?: { verdict?: 'pass' | 'fail' | null; leafOutcome?: LeafRunResult['outcome'] | null }) => Promise<NodeResult>;
  parkBlocked: (reason: string, verdict?: 'pass' | 'fail' | null) => Promise<LeafRunResult>;
  parkNodeStartFailure: (kind: LeafNodeKind, res: NodeResult) => Promise<LeafRunResult>;
  pausedResult: (kind: LeafNodeKind, res: NodeResult) => LeafRunResult;
  pausedForWorktreeAddFault: (kind: LeafNodeKind) => LeafRunResult;
  finalizeReportLeaf: (gateVerdict: 'pass' | 'fail', commitMessage: string) => Promise<LeafRunResult>;
  buildVerifySpec: (kind: 'driveplan' | 'driveexec' | 'report', cwd: string, verb: string, planText?: string, gateFindings?: string) => NodeSpec;
  nodeModel: (kind: LeafNodeKind, allowedTools?: string, depth?: ReviewDepth) => string;
  nodeEffort: (kind: LeafNodeKind, depth?: ReviewDepth) => EffortLevel;
  untrackedAtStart: string[];
}

export const ATTEMPT_CAP = 2;
export const NODE_BUDGET = 20;
/** Max number of times a single leaf run may self-raise its own node budget via a
 *  declined auto-split proposal (see `proposeThenAct`/raisedNodeBudget). Without a cap, a
 *  leaf that keeps proposing (and declining) a split across attempts lifts its own runaway
 *  ceiling every time it declines — an unbounded escape hatch out of the very budget meant
 *  to bound it. After the cap, a declined split no longer raises the budget; the leaf runs
 *  linear at whatever ceiling it already has, and the existing budget-exhaustion path
 *  (checkBudget/parkBlocked('node-budget-exhausted')) takes over as normal. */
export const MAX_BUDGET_RAISES = 2;

/** Whether a declined-split budget raise should still apply, given how many raises this
 *  run has already taken (see MAX_BUDGET_RAISES). Pure; exported for test. */
export function shouldRaiseBudget(raisesSoFar: number): boolean {
  return raisesSoFar < MAX_BUDGET_RAISES;
}
/** P6 surgical reuse: max in-place re-implement passes per attempt on a missing-logic
 *  review FAIL (a NEW finding) before discarding the worktree for a fresh attempt.
 *  FM2 (daemon-builder-trust-diagnostic): raised 1→3. The in-place loop already KEEPS
 *  the near-correct worktree and re-implements with the review findings — the right
 *  behaviour — but capping it at ONE fix discarded near-passing multi-file work after a
 *  single remediation and fell through to a FRESH-worktree attempt that re-ran the whole
 *  blueprint+waves pipeline from scratch (the dominant budget burn that sank b592428f).
 *  3 keeps fixing in place while findings PROGRESS; the real bounds remain the node
 *  budget (checkBudget gates every node) and the repeat-finding "stuck" guard (a
 *  recurring finding ⇒ a genuinely tainted tree ⇒ bail to a fresh attempt), so a
 *  hopeless leaf still gives up rather than burning the whole budget in place. */
export const REVISE_REUSE_CAP = 3;

/** Positive-int env override (returns `dflt` when unset/invalid). */
function envInt(name: string, dflt: number): number {
  const raw = process.env[name];
  if (!raw) return dflt;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/** Size gate (post-WAVES-retirement): a leaf touching `<= FILE_THRESHOLD` enumerated
 *  files runs LINEAR (FLOOR); more than that auto-splits PRE-FLIGHT into a Planner-
 *  reviewed per-file proposal (SPLIT_CEILING tracks this). Env-overridable.
 *
 *  Default raised 4→8 (2026-07-08) on the measurement in
 *  design-replace-worker-fanout-with-planner-decomposition: across 473 real runs the old
 *  WAVES fan-out path cost ~6× the nodes of the linear FLOOR path (27 vs 4.4) at no
 *  reliability gain — so the linear band was widened to ≤8 and WAVES retired. */
export const FILE_THRESHOLD = envInt('MERMAID_FILE_THRESHOLD', 8);
/** Auto-split ceiling (worker-decomposition): a leaf whose ENUMERATED file set exceeds
 *  this is decomposed PRE-FLIGHT into one child leaf per file (a visible split proposal
 *  the Planner reviews — promote, or reset-to-linear if the files are interdependent),
 *  rather than run as one over-large leaf. WAVES RETIRED (2026-07-08): the taxonomy is now
 *  just ≤ threshold → FLOOR (linear), > threshold → auto-split. So the ceiling tracks
 *  FILE_THRESHOLD — there is no middle fan-out band. (Design: the fan-out path cost ~6× a
 *  linear run at no reliability gain; see design-replace-worker-fanout-with-planner-
 *  decomposition.) A non-enumerable manifest can't be partitioned, so a big one falls
 *  through to FLOOR (fail-safe; ~0 occurrence in practice). */
export const SPLIT_CEILING = FILE_THRESHOLD;

export { VERIFY_GATE_VERB } from './leaf-prompts';
/** Node wall-clock cap for the verify EXECUTE node. The default 600s node timeout is sized for
 *  a code node; a CAD assembly build (load vendor STEP parts → build subassemblies → run
 *  geometry/DOF/clearance gates) legitimately runs longer, and the L4 dogfood hit the 600s
 *  kill mid-build. 20min gives heavy assemblies room while still bounding a true runaway. */
export const VERIFY_EXEC_TIMEOUT_MS = 1_200_000;

/** Per-node model + tool allowlist (blueprint §3). Bash is read-only by prompt
 *  convention (the CLI has no RO-bash flag). The space-separated list is passed
 *  straight to `--allowedTools` by the P1 invoker. */
/** Per-node reasoning effort baseline (epic: daemon-set effort). Reasoning-heavy
 *  nodes (the opus ones: blueprint/review/driveplan) default to 'high'; the
 *  implementation/read nodes (sonnet) default to 'medium'. A per-project override
 *  (getProjectEffort) or MERMAID_NODE_EFFORT can replace these uniformly. */
/** Every leaf-executor node kind, in a stable display order (drives the matrix editor). */
export const LEAF_NODE_KINDS: LeafNodeKind[] = [
  'blueprint', 'implement', 'review',
  'research', 'wimplement', 'verify', 'fix',
  'driveplan', 'driveexec', 'report',
  'summary',
];

/** Wall-clock cap for nodes that DO the build (implement-class). The invoker default
 *  (600s) killed real work mid-build — long implement runs are routine, especially on a
 *  Haiku node_profile_override pin. Stall detection is NOT slowed by this: the invoker's
 *  START WINDOW still kills a zero-output node at 600s (see node-invoker START_WINDOW_MS). */
export const IMPLEMENT_TIMEOUT_MS = 1_800_000;

/** Wall-clock cap for the blueprint node. Distinct from (and smaller than)
 *  {@link IMPLEMENT_TIMEOUT_MS} — blueprint does not edit code, but a large REMOVAL leaf's
 *  blueprint node was observed GROUNDING (enumerating every site to delete) past the
 *  invoker's 600s default before it ever reaches the citability gate, parking correct work
 *  as a start-window/timeout failure rather than a real rejection. 900s gives it room without
 *  matching implement's 1800s (blueprint still writes no code — a runaway blueprint should
 *  fail faster than a runaway build). */
export const BLUEPRINT_TIMEOUT_MS = 900_000;

export const NODE_PROFILE: Record<LeafNodeKind, { model: string; allowedTools: string; effort: EffortLevel; timeoutMs?: number }> = {
  // Demoted opus→sonnet (2026-07-21): blueprint was the #1 cost center ($368/wk, more than
  // implement) with no measured reliability gain over sonnet at 'high' effort. A project that
  // wants opus back can set a per-(project,kind) override (resolveNodeModel in node-provider.ts).
  // Effort stays 'high' — reasoning depth, not model tier, is what blueprint needs most.
  blueprint: { model: 'sonnet', allowedTools: 'Read Write Grep Glob Bash', effort: 'high', timeoutMs: BLUEPRINT_TIMEOUT_MS },
  implement: { model: 'sonnet', allowedTools: 'Read Edit Write Grep Glob Bash', effort: 'medium', timeoutMs: IMPLEMENT_TIMEOUT_MS },
  review: { model: 'opus', allowedTools: 'Read Grep Glob Bash', effort: 'high' },
  // P5 waves:
  research: { model: 'sonnet', allowedTools: 'Read Grep Glob Bash', effort: 'medium' }, // read-only (spec §12: sonnet for non-blueprint/review)
  wimplement: { model: 'sonnet', allowedTools: 'Read Edit Write Grep Glob Bash', effort: 'medium', timeoutMs: IMPLEMENT_TIMEOUT_MS }, // read+edit
  verify: { model: 'sonnet', allowedTools: 'Read Grep Glob Bash', effort: 'medium' }, // read + bash-tsc
  fix: { model: 'sonnet', allowedTools: 'Read Edit Write Grep Glob Bash', effort: 'medium', timeoutMs: IMPLEMENT_TIMEOUT_MS }, // read+edit
  // verify pipeline (epic f5c7fc46): plan authors an AssemblyBuildPlan; driveexec is
  // CONSTRAINED to the single deterministic gate verb (invokes, authors nothing); report
  // writes+commits findings and files one session-todo per finding.
  driveplan: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash', effort: 'high' },
  driveexec: { model: 'sonnet', allowedTools: `Read Write Bash ${VERIFY_GATE_MCP_TOOL}`, effort: 'medium' },
  // No Bash, no Write: the report node only READS the verdicts, files finding todos via MCP,
  // and EMITS the report markdown as its final message — the EXECUTOR writes it into the
  // worktree + commits it (L5: a node's new-file Write resolves to the project root, not the
  // worktree, so a node-written report never reaches mergeToEpic → accept reverses).
  report: { model: 'sonnet', allowedTools: 'Read Grep Glob mcp__mermaid__file_to_bucket', effort: 'medium' },
  // zen mode (design-zen-mode Phase 4): summarizes a watched session's progress. Read-only;
  // emits the summary as its final message (consumed by Z7). Default sonnet (claude-sonnet-4-6).
  summary: { model: 'sonnet', allowedTools: 'Read Grep Glob', effort: 'low' },
};

/** In-place start-failure escalation target (see the `escalatedKinds` mechanism in runLeaf):
 *  a node that starts failing on its pinned model retries ONCE on something STRONGER. This
 *  used to just read NODE_PROFILE.blueprint.model, which worked while blueprint was pinned to
 *  opus — but blueprint was demoted to sonnet (cost), which would have silently made the
 *  escalation a no-op for every kind already pinned at sonnet (implement, driveexec, ...).
 *  Kept as an explicit constant so a future blueprint-tier change can't neuter escalation again. */
export const ESCALATION_MODEL = 'opus';

export function resolveLightPathEnabled(project?: string): boolean {
  try {
    return isLightPathParityMet(project);
  } catch {
    return false;
  }
}

/** SR-7: a split child inherits its parent's plan slice, so its blueprint node RECONCILES
 *  instead of re-deriving. Cheap model, low effort. It is NOT skipped: the parent plan
 *  encodes cross-file contracts + test strategy that later siblings can invalidate, and
 *  SR-6's dependsOn bounds — but does not eliminate — that staleness. */
export const BLUEPRINT_REFRESH_PROFILE = { model: 'sonnet', effort: 'low' as EffortLevel };

/** Process-wide effort override: MERMAID_NODE_EFFORT forces every spawned node to a
 *  single level (blunt instrument; the per-project knob is preferred). */
const ENV_NODE_EFFORT: EffortLevel | undefined = (() => {
  const e = process.env.MERMAID_NODE_EFFORT;
  return e && (['low', 'medium', 'high', 'xhigh', 'max'] as string[]).includes(e) ? (e as EffortLevel) : undefined;
})();

import type { LeafNodeKind, LeafNodeGroup } from './leaf-prompts';
import {
  blueprintPath, verifyPlanPath, verifyResultPath, verifyReportPath, reviewReportPath,
  VERIFY_GATE_VERB, buildNodePrompt, buildBlueprintRefreshPrompt, buildCriteriaRepairPrompt,
  buildBlueprintRepairPrompt, buildBlueprintSummarizePrompt, buildVerifyPrompt,
  buildReviewPrompt, workingRootLines, REVIEW_LENS_INSTRUCTIONS,
  NODE_KIND_DESCRIPTIONS, MATRIX_HIDDEN_NODE_KINDS, LEAF_NODE_GROUPS, leafSessionKey,
} from './leaf-prompts';

/**
 * Absolute path of a leaf's per-run stream-json transcript, under the TRACKING
 * project (stable; the reader endpoint resolves the same path). Every node of the
 * leaf appends here with a boundary marker, so the file reads as one transcript
 * across the leaf's plan→build→verify→report chain (and across retries). Exported
 * so the reader route resolves the identical path.
 */
export function leafTranscriptPath(project: string, leafId: string): string {
  return join(project, '.collab', 'leaf-transcripts', `${leafId}.jsonl`);
}

export {
  buildNodePrompt, buildBlueprintRefreshPrompt, buildCriteriaRepairPrompt,
  buildBlueprintRepairPrompt, buildBlueprintSummarizePrompt, buildVerifyPrompt,
  buildReviewPrompt, workingRootLines, REVIEW_LENS_INSTRUCTIONS,
} from './leaf-prompts';
export type { NodeRoots } from './leaf-prompts';

/** Which EXECUTION SHAPE a leaf runs (epic f5c7fc46). 'code' (default) is the proven
 *  blueprint→implement/waves→tsc-review AUTHORING pipeline; 'verify' is the non-code
 *  dogfood pipeline (plan → deterministic driver verb → domain gate → committed report);
 *  'review' (epic d8ac1a18 dogfood) is a completeness review over an epic's union change-set
 *  (one LLM judgment node → committed report → file gap todos). Both verify and review are
 *  NON-AUTHORING shapes whose deliverable is a COMMITTED report (so they survive the
 *  completion gate's work-committed re-verify, exactly like the code path's commit).
 *  Keyed off the leaf's `type`: 'verify'/'cad-dogfood'/'dogfood' → verify; 'reviewer' →
 *  review; else code. THIN dispatch, deliberately NOT a recipe registry (YAGNI — only a few
 *  real shapes; see the recipe-space analysis in doc executor-recipe-registry-design). Pure. */
export function leafExecutionMode(leaf: Todo): 'code' | 'verify' | 'review' {
  const t = (leaf.type ?? '').toLowerCase();
  if (t === 'verify' || t === 'cad-dogfood' || t === 'dogfood') return 'verify';
  if (t === 'reviewer') return 'review';
  return 'code';
}

/** The node kinds a leaf's run will actually execute, keyed off leafExecutionMode. Drives the
 *  kind-scoped grok/xai auth pre-flight (bug 3764675c) so a dead-kind override can't gate a
 *  floor leaf. Pure. */
export function leafRunKinds(leaf: Todo): LeafNodeKind[] {
  switch (leafExecutionMode(leaf)) {
    case 'verify': return ['driveplan', 'driveexec', 'report'];
    case 'review': return ['review'];
    default: return ['blueprint', 'implement', 'review']; // floor
  }
}

/** One warning per (project, epic): an undeclared gate is a legitimate config, but its absence must
 *  never be invisible — a 1.00 accept rate looks identical with and without a mechanical gate. */
const warnedGateAbstention = new Set<string>();
function warnGateAbstention(project: string, epicId: string, gateProject: string, d: { manifestPath: string; reason: string }): void {
  const key = `${project}::${epicId}`;
  if (warnedGateAbstention.has(key)) return;
  warnedGateAbstention.add(key);
  console.warn(
    `[leaf-gate] NO MECHANICAL GATE for project ${gateProject} (epic ${epicId.slice(0, 8)}): ${d.reason}. ` +
    `Consulted ${d.manifestPath}. Leaves will be accepted on the reviewer's verdict ALONE.`,
  );
}

/** The `runGate` dep is UNWIRED (no G2 mechanical layer at all — not even a manifest
 *  consult). Distinct from an ABSENT declaration: there, the project said "no gate";
 *  here, the executor was constructed without the seam. Both end at "the LLM verdict
 *  alone decides", and neither may be invisible. */
const warnedGateUnwired = new Set<string>();
function warnGateUnwired(project: string, epicId: string): void {
  const key = `${project}::${epicId}`;
  if (warnedGateUnwired.has(key)) return;
  warnedGateUnwired.add(key);
  console.warn(
    `[leaf-gate] runGate DEP UNWIRED for project ${project} (epic ${epicId.slice(0, 8)}): the executor ` +
    `has no mechanical gate seam. Leaves will be accepted on the reviewer's verdict ALONE.`,
  );
}

/**
 * Drive ONE leaf todo through the deterministic blueprint→implement→review loop.
 *
 * @param project The TRACKING project (where the todo + lease live).
 * @param leaf    The claimed leaf todo (already in_progress).
 * @param deps    Injected seam. Use {@link makeLeafExecutorDeps} for the real wiring.
 */
/** How to (re)dispatch a leaf that may have durable resume state. */
export type ResumeMode = 'fresh' | 'skip-to-gate' | 'reattach-blueprint' | 'rebase-continue';
export interface ResumePlan { mode: ResumeMode; reason: string }

/**
 * Decide how to dispatch a leaf given its durable resume row and the CURRENT epic
 * tip (leaf-phase-checkpoint-design slice 2). Pure + total — unit-tested without
 * git/db. Conservatism is deliberate: any doubt resolves to a clean FRESH run.
 *
 * - no resume row                  → fresh (first dispatch)
 *                                     (EXCEPT: when hasBlueprintOutput=true AND
 *                                     blueprintBaseSha matches currentEpicSha, a durable
 *                                     blueprint authored against the CURRENT tip is still
 *                                     reusable — reattach-blueprint instead)
 * - merged                         → skip-to-gate (work is committed; the gate
 *                                     re-verifies it — safe regardless of further
 *                                     epic advance; redoing the leaf is pure waste)
 * - killed at/before blueprint     → fresh (nothing durable to reuse)
 *                                     (EXCEPT: when hasBlueprintOutput=true, a
 *                                     completed blueprint was durably recorded;
 *                                     treat as reattach-blueprint instead)
 * - epic base moved + implement done→ rebase-continue (the durable blueprint is stale,
 *                                     but implement completed — rebase the worktree
 *                                     instead of re-running blueprint)
 * - epic base moved + spec unchanged→ reattach-blueprint (spec signature matches,
 *                                     so the blueprint is still valid despite the
 *                                     base move; avoid re-authoring the blueprint)
 * - epic base missing/moved        → fresh (the blueprint was authored against the
 *                                     old tip; resuming against a changed world is
 *                                     Grok's #1 risk — never do it, unless implement
 *                                     already completed and a rebase is possible)
 * - blueprint done + base unchanged→ reattach-blueprint (reuse the DURABLE blueprint
 *                                     plan in a FRESH worktree, re-run implement→
 *                                     review; saves the ~4.5min blueprint without
 *                                     reusing any partial implementation)
 * - same-wall retry (hard wall + repeated)→ fresh (poisoned-blueprint-same-wall: never
 *                                     reattach a plan that hit the same hard wall; author
 *                                     a fresh blueprint instead to break the cycle)
 */
export function planResume(
  resume: { phase?: string | null; merged: boolean; epicBaseSha?: string | null } | null,
  currentEpicSha: string | null,
  hasBlueprintOutput = false,
  /** Durable base SHA the reusable blueprint was authored against (leaf_blueprint).
   *  Used when the run checkpoint was cleared by a terminal outcome but the blueprint
   *  itself is still valid. */
  blueprintBaseSha: string | null = null,
  /** True when the durable resume signal shows implement already ran to completion
   *  (derived by the CALLER from resume.phase — this function just consumes the boolean). */
  hasCompletedImplement = false,
  /** True when the leaf's title/description/inheritedFiles have NOT changed despite an
   *  epic-base move. When true and hasCompletedImplement is false, return reattach-blueprint
   *  instead of fresh to avoid re-authoring the blueprint. */
  specUnchanged = false,
  /** Prior run wall history: repeated hard walls and last reason class. When a hard wall
   *  repeated or occurred multiple times, downgrade reattach-blueprint to fresh to author
   *  a new blueprint instead of replaying the poisoned plan. */
  priorWall: { repeatedWall: boolean; lastReasonClass: string } | null = null,
): ResumePlan {
  function poisonedBlueprint(p: { repeatedWall: boolean; lastReasonClass: string } | null): boolean {
    return !!p && (p.repeatedWall || isHardWall(p.lastReasonClass as WallReasonClass));
  }

  let plan: ResumePlan;

  if (!resume) {
    // D1: a terminal outcome cleared the run checkpoint, but a durably-recorded
    // blueprint authored against the CURRENT tip is still reusable. The base guard
    // below is identical to the resume-row path — never weaker.
    if (hasBlueprintOutput && blueprintBaseSha && currentEpicSha) {
      if (blueprintBaseSha === currentEpicSha)
        plan = { mode: 'reattach-blueprint', reason: 'blueprint-reusable-no-resume-row' };
      else if (hasCompletedImplement)
        return { mode: 'rebase-continue', reason: 'epic-base-moved-rebase' };
      else if (specUnchanged)
        plan = { mode: 'reattach-blueprint', reason: 'epic-base-moved-spec-unchanged' };
      else
        return { mode: 'fresh', reason: 'epic-base-moved' };
    } else {
      // D3: null currentEpicSha is silently fatal — we can't verify the world state.
      if (!currentEpicSha) return { mode: 'fresh', reason: 'no-epic-base' };
      return { mode: 'fresh', reason: 'no-resume-state' };
    }
  } else if (resume.merged) {
    return { mode: 'skip-to-gate', reason: 'work-merged' };
  } else if ((!resume.phase || resume.phase === 'blueprint') && !hasBlueprintOutput) {
    // Paused/killed at-or-before the blueprint node. If a COMPLETED blueprint was
    // durably recorded (the leaf rate-paused after authoring it), reuse it instead of
    // re-burning the ~opus blueprint node — the 1.8M-token re-burn loop. Only treat as
    // genuinely fresh when no usable blueprint output exists.
    return { mode: 'fresh', reason: 'killed-before-blueprint' };
  } else {
    // Fall back to the durable blueprint base when the row lost its sha (COALESCE gap).
    const base = resume.epicBaseSha ?? blueprintBaseSha;
    if (!base || !currentEpicSha) return { mode: 'fresh', reason: 'no-epic-base' };
    if (base !== currentEpicSha) {
      if (hasCompletedImplement)
        return { mode: 'rebase-continue', reason: 'epic-base-moved-rebase' };
      if (specUnchanged)
        plan = { mode: 'reattach-blueprint', reason: 'epic-base-moved-spec-unchanged' };
      else
        return { mode: 'fresh', reason: 'epic-base-moved' };
    } else {
      plan = { mode: 'reattach-blueprint', reason: 'blueprint-reusable' };
    }
  }

  // Post-filter: downgrade reattach-blueprint to fresh when the prior dispatch hit a hard wall
  // (and it repeated or was classified as hard). This breaks the poison-pill loop by forcing
  // a new blueprint instead of replaying a plan that failed the same way.
  if (plan && plan.mode === 'reattach-blueprint' && poisonedBlueprint(priorWall)) {
    return { mode: 'fresh', reason: 'poisoned-blueprint-same-wall' };
  }
  return plan || { mode: 'fresh', reason: 'no-resume-state' };
}

/** Pure classifier for the {@link LeafExecutorDeps.worktreeBaseFresh} probe's raw git
 *  verdict. `isAncestor` mirrors `git merge-base --is-ancestor <tip> HEAD`'s three-way
 *  result: true (still an ancestor ⇒ fresh), false (tip has moved past the fork point ⇒
 *  STALE), or null (indeterminate — non-git project, git error, or the dep unwired).
 *  Total + git-free so it is unit-testable without a real repo. FAIL-OPEN: only an
 *  explicit `false` classifies as stale — a broken/indeterminate probe must never park a
 *  healthy leaf. */
export function classifyWorktreeBaseFreshness(isAncestor: boolean | null): { fresh: boolean } {
  return { fresh: isAncestor !== false };
}

/** Start-failure circuit-breaker (bug a8935a16): a node that keeps failing to START gets at
 *  most this many retries before the leaf is durably HELD instead of released for re-claim.
 *  1 ⇒ one retry, then park on the SECOND consecutive start-failure. Without this, a start
 *  failure released→re-claimed up to MAX_CLAIM_RETRIES (4) times, each spin eating a full
 *  startup window — the 4×600s amplifier. Gated on the leaf's retryCount (durable across
 *  dispatches), so a leaf that already burned a retry and STILL can't start stops spinning. */
export const MAX_START_FAILURE_RETRIES = 1;

/** A node that never STARTED: it produced NO positive evidence of running, and it died
 *  fast or timed out. "Positive evidence of running" is ANY of: a parsed
 *  `--output-format json` result object (`hasResultJson`), a non-empty final message
 *  (`text`), or a non-zero token count. Absence of tokens ALONE is no longer
 *  sufficient — a provider can omit usage data on a genuine run (e.g. rate-limited
 *  responses, some grok shapes), and misclassifying that as a start failure trips the
 *  start-failure circuit breaker (parkNodeStartFailure / MAX_START_FAILURE_RETRIES) on
 *  a node that actually ran. Only when EVERY signal is absent (zero tokens AND no
 *  parsed result JSON AND no non-empty text) do we treat it as never-started; a node
 *  that timed out having already produced real output is a normal (mid-run) failure,
 *  not a start failure. Rate-limited results are excluded (their own pause path).
 *  Require minimum ~100ms duration so we don't match test mocks; real CLI failures
 *  take at least that long to fork+exit. */
export function isNodeStartFailure(res: NodeResult): boolean {
  if (res.rateLimited || res.ok) return false;
  const u = res.usage;
  const zeroTokens = ((u?.inputTokens ?? 0) + (u?.outputTokens ?? 0) + (u?.cacheReadTokens ?? 0)) === 0;
  const hasOutput = res.hasResultJson === true || !!(res.text && res.text.trim().length > 0);
  if (!zeroTokens || hasOutput) return false;
  // A node killed at its wall-clock timeout having burned ZERO tokens AND produced no
  // usable result object/text never ran — a provider/model/config startup fault (e.g.
  // hung at SessionStart). Classify as a node-START failure regardless of duration; the
  // discriminator is "no output at all", NOT dur. A timeout that DID produce real
  // output falls through (hasOutput above already returned false for it).
  if (res.timedOut) return true;
  // Otherwise: only a FAST zero-token, no-output death (real CLI fork+exit fault); the
  // [100,5000) floor avoids matching sub-100ms test mocks.
  const dur = res.durationMs ?? 0;
  return dur >= 100 && dur < 5_000;
}

/** SR-7: inheritance from a parent's durable blueprint plan, scoped to a child's file slice.
 *  A split child's blueprint node RECONCILES instead of deriving from zero. */
export interface InheritedSlice {
  from: string;
  files: string[];
  text: string;
}

/** SR-7: null ⇒ run the ordinary FULL blueprint (not a split child, plan gone, or the
 *  inherited slice never mentions a file the child owns — an under-specified parent). */
export function resolveInheritedSlice(
  leaf: Todo,
  restore: ((leafId: string) => string | null) | undefined,
): InheritedSlice | null {
  const from = leaf.inheritedBlueprintFrom;
  const files = leaf.inheritedFiles ?? [];
  if (!from || files.length === 0 || !restore) return null;
  const text = restore(from);
  if (!sliceCoversFiles(text, files)) return null;
  return { from, files, text: text as string };
}

/**
 * REVIEW PASS: run a single review pass with the given lens (lifted to module scope).
 */
async function runReviewPass(
  ctx: LeafRunContext,
  lens: ReviewLens,
  buildReviewSpec: (lens: ReviewLens) => NodeSpec,
): Promise<ReviewPassResult | { failure: string }> {
  let rev = await ctx.runNode('review', buildReviewSpec(lens));
  if (rev.startFailure) return { failure: 'start-failure' };
  if (rev.rateLimited) return { failure: 'rate-limited' };
  if (!ctx.checkBudget()) return { failure: 'budget-exhausted' };
  if (!rev.ok) {
    rev = await ctx.runNode('review', buildReviewSpec(lens));
    if (rev.rateLimited) return { failure: 'rate-limited' };
    if (!ctx.checkBudget()) return { failure: 'budget-exhausted' };
  }
  if (!rev.ok) return { failure: 'node-failed' };

  // CONTENT GATE: report must be non-empty and end with a parseable VERDICT line.
  const reportMd = (rev.text ?? '').trim();
  if (!reportMd) return { failure: 'report-empty' };
  const parsedVerdict = parseVerdict(reportMd);
  if (parsedVerdict === 'error') return { failure: 'report-no-verdict' };

  return {
    lens,
    verdict: parsedVerdict,
    report: reportMd,
  };
}

/**
 * REVIEW pipeline (epic d8ac1a18 dogfood): a single read-only LLM judgment node reviews
 * the epic's UNION change-set (git diff <epic-base>...HEAD) against the leaf's inlined spec,
 * files one session-todo per gap, and emits the report markdown. The EXECUTOR writes +
 * commits that report (docs/review/<id>.report.md) and merges it onto the epic branch —
 * so the deliverable is a COMMITTED report that survives the work-committed re-verify, the
 * same way verify does. The trailing `VERDICT:` line is the CONTENT GATE (re-arms the
 * hallucination guard at the content layer): an empty report or one with no parseable
 * verdict parks the leaf blocked. A FAIL verdict still ACCEPTS — gaps are the deliverable
 * (filed as todos), not a rejection; the human reads the report before [LAND]. Single pass,
 * one in-place retry on a failed node (mirrors the verify plan-node retry).
 */
export async function runReviewPipeline(ctx: LeafRunContext): Promise<LeafRunResult> {
  ctx.state.attempt = 1; // single pass (no fresh-worktree retry loop)
  ctx.state.pathTaken = 'review';
  let wt: Awaited<ReturnType<WorktreeManager['ensure']>>;
  try {
    wt = await ctx.deps.wm.ensure(ctx.sessionKey, { baseBranch: ctx.epicBranch, fresh: true });
  } catch (e) {
    if (e instanceof Error && classifyWorktreeAddFault(e.message)) {
      return ctx.pausedForWorktreeAddFault('review');
    }
    throw e;
  }
  const cwd = wt.path;
  // The union change-set base: the epic branch was cut off the repo's trunk, so
  // <baseRef>..HEAD is the epic's accumulated work. ctx.deps.baseBranch is detected at
  // deps-construction (falls back to 'master' only when a caller doesn't thread it —
  // e.g. legacy test fixtures); a non-master-trunk project no longer silently diffs
  // against a nonexistent 'master'. The node is told to fall back if the ref doesn't resolve.
  const baseRef = ctx.deps.baseBranch ?? 'master';
  // The review node needs file_to_bucket (file gap todos) on top of the read-only set;
  // NO Write (the executor commits the report — a node Write resolves to the project root).
  const reviewTools = `${NODE_PROFILE.review.allowedTools} mcp__mermaid__file_to_bucket`;
  const reviewInjected = composeInjectedContext({ kind: 'review', project: ctx.project, epicId: ctx.epicId, flags: getInjectionFlags(ctx.project) });

  // Route review depth based on diff risk (hot-path changes, large diffs, etc.).
  const risk = await (ctx.deps.collectDiffRisk ?? collectDiffRisk)(cwd, baseRef);
  const route = routeReviewDepth(risk, { lightPathEnabled: resolveLightPathEnabled(ctx.project) });

  const buildReviewSpec = (lens: ReviewLens): NodeSpec => ({
    prompt: buildReviewPrompt(ctx.leaf, baseRef, lens),
    model: ctx.nodeModel('review', reviewTools, route.depth),
    effort: ctx.nodeEffort('review', route.depth),
    allowedTools: reviewTools,
    mcpConfig: mcpConfigFor(config.PORT),
    strictMcpConfig: true,
    cwd,
    leafId: ctx.leaf.id,
    epicId: ctx.epicId,
    permissionMode: resolveNodePermissionMode(),
    transcriptPath: leafTranscriptPath(ctx.project, ctx.leaf.id),
    transcriptLabel: 'review',
    appendSystemPrompt: reviewInjected || undefined,
  });

  // Run pass 1 (completeness).
  const pass1 = await runReviewPass(ctx, 'completeness', buildReviewSpec);
  if ('failure' in pass1) {
    const failure = pass1.failure;
    if (failure === 'start-failure') return ctx.parkNodeStartFailure('review', {} as any);
    if (failure === 'rate-limited') return ctx.pausedResult('review', {} as any);
    if (failure === 'budget-exhausted') return ctx.parkBlocked('node-budget-exhausted');
    if (failure === 'node-failed') return ctx.parkBlocked('review-node-failed');
    if (failure === 'report-empty') return ctx.parkBlocked('review-report-empty');
    if (failure === 'report-no-verdict') return ctx.parkBlocked('review-report-no-verdict');
    return ctx.parkBlocked('review-node-failed');
  }

  // If standard depth, return immediately with pass 1.
  if (route.depth !== 'heavy') {
    const { verdict, report } = pass1;
    try {
      await ctx.deps.writeArtifact?.(cwd, reviewReportPath(ctx.leaf), report);
    } catch (e) {
      return ctx.parkBlocked(
        `review-report-write-failed: ${e instanceof Error ? e.message : String(e)}`,
        verdict,
      );
    }
    return ctx.finalizeReportLeaf(verdict, `review: ${ctx.leaf.title ?? ctx.leaf.id}`);
  }

  // Heavy depth: run pass 2 (regression-blast-radius) with one attempt, no retry.
  // If it fails for any reason, degrade to pass 1.
  let pass2: ReviewPassResult | undefined;
  let degradeReason: string | undefined;
  try {
    const pass2Result = await runReviewPass(ctx, 'regression-blast-radius', buildReviewSpec);
    if ('failure' in pass2Result) {
      degradeReason = `pass-2-${pass2Result.failure}`;
    } else {
      pass2 = pass2Result;
    }
  } catch (e) {
    degradeReason = `pass-2-exception: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (degradeReason) {
    ctx.deps.recordNode?.({
      project: ctx.project, todoId: ctx.leaf.id, session: ctx.sessionKey, epicId: ctx.epicId, leafId: ctx.leaf.id,
      nodeKind: 'review-lens-degraded',
      outputText: `degraded: ${degradeReason}`,
    });
  }

  // Join the passes (if pass 2 failed, join only pass 1; joinReviewReports handles single pass).
  const passes = pass2 ? [pass1, pass2] : [pass1];
  const joined = joinReviewReports(passes);

  try {
    await ctx.deps.writeArtifact?.(cwd, reviewReportPath(ctx.leaf), joined.report);
  } catch (e) {
    return ctx.parkBlocked(
      `review-report-write-failed: ${e instanceof Error ? e.message : String(e)}`,
      joined.verdict,
    );
  }

  if (!degradeReason) {
    ctx.deps.recordNode?.({
      project: ctx.project, todoId: ctx.leaf.id, session: ctx.sessionKey, epicId: ctx.epicId, leafId: ctx.leaf.id,
      nodeKind: 'review-panel-join',
      verdict: joined.verdict,
      outputText: `lenses: ${joined.lenses.join(', ')}`,
    });
  }

  return ctx.finalizeReportLeaf(joined.verdict, `review: ${ctx.leaf.title ?? ctx.leaf.id}`);
}

/**
 * VERIFY pipeline (epic f5c7fc46): plan(LLM authors AssemblyBuildPlan) → execute(node
 * constrained to the deterministic gate verb, captures raw result) → gate(executor parses
 * the verb's TRUE verdicts) → report(LLM writes+commits findings, files one todo each).
 * The LLM authors + reports (both safe, committable) but is OUT of the stateful execution
 * loop — the deterministic verb does the CAD (Grok's key point). The deliverable is a
 * COMMITTED report, so it reuses the SAME mergeToEpic/complete machinery as the code path
 * (no no-commit escape hatch). A failing DOMAIN gate is not an executor failure — it is the
 * finding the leaf exists to surface, so it still reports + accepts; only an INFRA error
 * (verb crashed / no parseable verdict) parks blocked. L3: the gate is a PLUGGABLE
 * {verb, command} ({@link resolveVerifyGate}) — the verb result AND an optional shell
 * command gate (e.g. pytest) compose into the findings. Spends 3–4 nodes through the
 * shared budget/runNode.
 */
export async function runVerifyPipeline(ctx: LeafRunContext): Promise<LeafRunResult> {
  ctx.state.attempt = 1; // single pass (no fresh-worktree retry loop) — telemetry shows attempts=1
  const cfg = (ctx.deps.resolveVerifyGate ?? resolveVerifyGate)(ctx.leaf); // L3: pluggable {verb, command}
  let wt: Awaited<ReturnType<WorktreeManager['ensure']>>;
  try {
    wt = await ctx.deps.wm.ensure(ctx.sessionKey, { baseBranch: ctx.epicBranch, fresh: true });
  } catch (e) {
    if (e instanceof Error && classifyWorktreeAddFault(e.message)) {
      return ctx.pausedForWorktreeAddFault('driveplan');
    }
    throw e;
  }
  const cwd = wt.path;

  // 1. PLAN — author the AssemblyBuildPlan. One in-place retry on a failed node (mirrors
  //    the code path's blueprint retry) before parking.
  let plan = await ctx.runNode('driveplan', ctx.buildVerifySpec('driveplan', cwd, cfg.verb));
  if (plan.rateLimited) return ctx.pausedResult('driveplan', plan);
  if (!ctx.checkBudget()) return ctx.parkBlocked('node-budget-exhausted');
  if (!plan.ok) {
    plan = await ctx.runNode('driveplan', ctx.buildVerifySpec('driveplan', cwd, cfg.verb));
    if (plan.rateLimited) return ctx.pausedResult('driveplan', plan);
    if (!ctx.checkBudget()) return ctx.parkBlocked('node-budget-exhausted');
  }
  if (!plan.ok) return ctx.parkBlocked('verify-plan-node-failed');

  // Read the plan artifact back (deterministic source); fall back to the node's final text.
  const planFromFile = await ctx.deps.readArtifact?.(cwd, verifyPlanPath(ctx.leaf)).catch(() => undefined);
  const planText = planFromFile && planFromFile.trim() ? planFromFile : plan.text;
  if (!planText || !planText.trim()) return ctx.parkBlocked('verify-plan-empty');

  // 2. EXECUTE — node constrained to the resolved verb; captures its raw result. The verb
  //    call is a single network-heavy MCP round-trip, so give ONE in-place retry on a
  //    transient node failure (e.g. the "Connection closed while thinking" API drop seen in
  //    the first live T14 run) before parking — mirrors the blueprint-node retry. The verb is
  //    deterministic/idempotent, so re-calling is safe.
  let exec = await ctx.runNode('driveexec', ctx.buildVerifySpec('driveexec', cwd, cfg.verb, planText));
  if (exec.rateLimited) return ctx.pausedResult('driveexec', exec);
  if (!ctx.checkBudget()) return ctx.parkBlocked('node-budget-exhausted');
  if (!exec.ok) {
    exec = await ctx.runNode('driveexec', ctx.buildVerifySpec('driveexec', cwd, cfg.verb, planText));
    if (exec.rateLimited) return ctx.pausedResult('driveexec', exec);
    if (!ctx.checkBudget()) return ctx.parkBlocked('node-budget-exhausted');
  }
  if (!exec.ok) return ctx.parkBlocked('verify-execute-node-failed');

  // 3. GATE — parse the verb's TRUE verdicts from the result artifact (not the prose).
  const resultFromFile = await ctx.deps.readArtifact?.(cwd, verifyResultPath(ctx.leaf)).catch(() => undefined);
  const resultText = resultFromFile && resultFromFile.trim() ? resultFromFile : exec.text;
  const gate = parseVerifyGate(resultText);
  // INFRA error (verb crashed / no parseable verdict) is NOT a finding → park blocked.
  if (gate.status === 'error') return ctx.parkBlocked(gate.reasons[0] ?? 'verify-gate-error', 'fail');
  // 'pass' or 'fail' (real domain findings) both proceed; the command gate composes below.
  const findings = [...gate.reasons];

  // 3b. COMMAND GATE (L3, optional) — run the config's shell gate in the worktree, composed
  //     AFTER the verb gate. A spawn failure (ran:false) is INFRA → park blocked; a non-zero
  //     exit (ran:true, ok:false) is a FINDING folded into the report alongside the verdicts.
  if (cfg.command) {
    const cmd = await ctx.deps.runCommandGate?.(cwd, cfg.command);
    if (!cmd) return ctx.parkBlocked(`verify-command-gate-unwired: ${cfg.command}`, 'fail');
    if (!cmd.ran) return ctx.parkBlocked(`verify-command-gate-failed-to-run: ${cfg.command}`, 'fail');
    if (!cmd.ok) findings.push(`command gate failed: \`${cfg.command}\`\n${cmd.output.slice(0, 2000)}`);
  }

  // 4. REPORT — write + commit the findings .md, file one session-todo per finding.
  const report = await ctx.runNode(
    'report',
    ctx.buildVerifySpec('report', cwd, cfg.verb, planText, findings.join('\n')),
  );
  if (report.rateLimited) return ctx.pausedResult('report', report);
  if (!ctx.checkBudget()) return ctx.parkBlocked('node-budget-exhausted');
  if (!report.ok) return ctx.parkBlocked('verify-report-node-failed');

  // L5: the EXECUTOR persists the report into the worktree (the node only emitted it) — a
  // node's new-file Write resolves to the project root, not the worktree, so it would never
  // reach mergeToEpic. Write it at the worktree path; an empty report is an executor failure.
  const reportMd = (report.text ?? '').trim();
  if (!reportMd) return ctx.parkBlocked('verify-report-empty');
  try {
    await ctx.deps.writeArtifact?.(cwd, verifyReportPath(ctx.leaf), reportMd);
  } catch (e) {
    return ctx.parkBlocked(`verify-report-write-failed: ${e instanceof Error ? e.message : String(e)}`, 'fail');
  }

  // Overall verdict: clean ONLY if BOTH the verb gate passed AND no command-gate finding.
  // COMMIT-SHAPED DELIVERABLE: the shared report tail merges the committed report onto the
  // epic branch BEFORE proposing acceptance, exactly like the code path, so the gate's
  // work-committed re-verify sees committed work. A failing DOMAIN gate is captured in the
  // report + filed findings, not a rejected leaf.
  const gateVerdict: 'pass' | 'fail' = findings.length === 0 ? 'pass' : 'fail';
  return ctx.finalizeReportLeaf(gateVerdict, `verify: ${ctx.leaf.title ?? ctx.leaf.id}`);
}

export async function runLeaf(
  project: string,
  leaf: Todo,
  deps: LeafExecutorDeps,
): Promise<LeafRunResult> {
  // Fail-fast auth gate — ONCE, before any node. Throws under an API key; the
  // launchWorker branch catches → release + escalate (no tmux fallback). Claude is always
  // required (review + MCP nodes stay claude). When ANY node may route to grok, pre-flight
  // grok auth too so a MIXED leaf fails fast rather than stranding after the cheap grok work
  // (Grok review risk #3).
  await deps.assertAuth();
  const runKinds = leafRunKinds(leaf);
  if (grokNeededForKinds(project, runKinds)) await (deps.assertGrokAuth ?? assertGrokAuth)();
  if (xaiApiNeededForKinds(project, runKinds)) await (deps.assertXaiApiAuth ?? assertXaiApiAuth)();

  const sessionKey = leafSessionKey(leaf);
  const { epicId, epicBranch } = deps;

  // FM3 (daemon-builder-trust-diagnostic): the executor never removed its own
  // `leaf-exec-<id8>` worktree on a terminal outcome, so every completed leaf leaked
  // one (51 orphans observed). Reap it here on ANY terminal result — `git worktree
  // remove` keeps the BRANCH, so accepted work (already merged) and any un-merged
  // blocked/rejected work stays recoverable on demand. A `pending` (paused/resumable)
  // leaf KEEPS its worktree. Best-effort: never let cleanup change the outcome.
  const finishWith = async (r: LeafRunResult): Promise<LeafRunResult> => {
    // RUN-LEVEL inflight clear (bug 0f1df3d2): the leaf_inflight row now SPANS the
    // whole run (runNode no longer deletes it per-node — that left a between-nodes
    // window with no row, momentarily reclaimable). finishWith is the single terminal
    // funnel for every outcome (terminal AND pending/paused), so clearing here drops
    // the row exactly when the run stops executing a node. A paused leaf is no longer
    // live → correctly becomes re-dispatchable. The ownership-CAS discard path clears
    // it independently; process death is handled by reapStaleInflight (stale epoch).
    try { deps.clearInflight?.(leaf.id); } catch { /* best-effort */ }
    // Keep the worktree for RESUMABLE outcomes (pending = gate-deferred, paused =
    // rate-limited) — those re-dispatch and reuse/rebuild from it. Reap on every
    // TERMINAL outcome (accepted/blocked/rejected/split), EXCEPT an epic-base-moved
    // park after a successful reintegration (flag keepWorktreeOnBaseMovedPark).
    if (r.outcome !== 'pending' && r.outcome !== 'paused' &&
        !(r.outcome === 'blocked' && r.reason === 'epic-base-moved' && keepWorktreeOnBaseMovedPark)) {
      try { await deps.wm.remove(sessionKey); } catch { /* best-effort reap */ }
      // A dead worktree must never leave a leaf_resume row pointing at it — a hard kill
      // or a throw (aborted/blocked/rejected) never reaches the daemon's own
      // `clearLeafResume` call (that lives on the RETURNED-result continuation path only).
      try { deps.clearResume?.(leaf.id); } catch { /* best-effort */ }
    }
    return r;
  };

  // Single mutable run-state held in this closure (the budget counter must span
  // ALL attempts and ALL node kinds).
  // nodesSpent is SEEDED from startNodesSpent (P3 resume) so the master budget is
  // global across pause/resume cycles, not reset per re-dispatch.
  const state = { attempt: 0, nodesSpent: deps.startNodesSpent ?? 0, pathTaken: null as 'floor' | 'waves' | 'review' | null };
  // C2: accumulate recorded commands from each node for evidence gating in review
  const recordedCommands: RecordedCommand[] = [];
  // WORKING-ROOT GUARD: the last detected escape of the shell out of the lane worktree by a
  // MUTATING/verifying command. Surfaced (warn + ledger row) the moment it is detected —
  // right after the implement/fix node — so the operator sees the CAUSE instead of a mystery
  // empty diff four minutes later. ADVISORY by design: it never aborts a node (an escaped
  // verification is a legitimate, already-supported baseline pattern), but when the run then
  // DOES die on an empty diff, the escalation names it first. Fails open on any fault.
  let workingRootEscape: { escaped: RecordedCommand[]; message: string } | null = null;
  const checkWorkingRootEscape = (worktreeCwd: string): void => {
    try {
      const found = detectWorkingRootEscape({
        commands: recordedCommands,
        worktreeRoot: worktreeCwd,
        mainCheckoutRoot: deps.mainCheckoutRoot ?? null,
      });
      if (!found) return;
      if (workingRootEscape && workingRootEscape.escaped.length === found.escaped.length) return; // already surfaced
      workingRootEscape = found;
      console.warn(`[leaf-executor] ${found.message}`);
      try {
        deps.recordNode({
          project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
          nodeKind: 'working-root-escape', nodesSpent: 0, verdict: 'fail',
          outcomeDetail: JSON.stringify({
            reason: 'working-root-escape',
            worktree: worktreeCwd,
            mainCheckout: deps.mainCheckoutRoot ?? null,
            commands: found.escaped.slice(0, 5).map((c) => ({ cmd: c.cmd.slice(0, 200), cwd: c.cwd })),
          }),
          outputText: found.message,
        });
      } catch { /* telemetry — never break the run */ }
    } catch { /* advisory — never break the run */ }
  };
  // REBASE-CONTINUE: when a successful reintegration is adopted, flag it so a
  // subsequent base-moved park does NOT reap the lane worktree (it's closer to done).
  let keepWorktreeOnBaseMovedPark = false;

  // crit 6 OPTIMISTIC LANDING (small/test-pinned tiers only): the leaf merges to the epic
  // branch immediately after a GREEN mechanical gate — BEFORE review — then review runs
  // POST-merge. `optimisticallyLanded` gates two things: (1) the post-loop accept path skips
  // a SECOND merge (the work is already on the branch), and (2) parkBlocked auto-reverts the
  // merge (via deps.revertEpicMerge) before parking, so a real post-land review FAIL — or any
  // terminal park after the merge — never leaves failed-review code stranded on the epic
  // branch. `optimisticMergeSha` is the --no-ff merge commit to revert. Full tier: both stay
  // untouched and the pipeline is byte-identical to pre-crit-6.
  let optimisticallyLanded = false;
  let optimisticMergeSha: string | undefined;

  // PROSE-GATE RETRY: DURABLE per-leaf offense counters for the three prose gates
  // (review-unparseable, G3-vacuous, command-evidence). Declared OUTSIDE the attempt
  // loop (below) so 'repeat-within-leaf' is real across attempts — never reset.
  // PER-KIND counting (fix): a single run-wide counter previously parked on the SECOND
  // offense even when it was a DIFFERENT gate on a legitimately different cycle (e.g.
  // review-vacuous then command-evidence). Now: first offense of EACH kind → record an
  // audit note and RETRY; second-or-later offense of the SAME kind → park; an overall
  // ceiling (MAX_TOTAL_PROSE_RETRIES) still bounds how many distinct-kind retries a leaf
  // can chain. A red MECHANICAL gate still parks unconditionally (that path never calls
  // proseOffense). See prose-gate-retry.ts.
  const proseGateOffensesByKind = new Map<string, number>();
  let proseGateOffensesTotal = 0;
  const proseOffense = async (kind: string, reason: string): Promise<{ park: boolean; findings: string }> => {
    proseGateOffensesTotal += 1;
    const offenseCountForKind = (proseGateOffensesByKind.get(kind) ?? 0) + 1;
    proseGateOffensesByKind.set(kind, offenseCountForKind);
    const park = proseGateDisposition({ offenseCountForKind, totalOffenseCountSoFar: proseGateOffensesTotal }).action === 'park';
    // Record the incident as a ledger node on EVERY offense (retry and park) so the
    // graph shows it — retryCount alone previously hid first-offense prose incidents.
    // The kind + occurrence number make the audit trail legible across gate kinds.
    const detail = `[${kind} #${offenseCountForKind}] ${reason}`;
    try {
      deps.recordNode({
        project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
        nodeKind: 'grounding-audit', nodesSpent: 0, verdict: 'fail',
        outcomeDetail: detail, outputText: detail,
      });
    } catch { /* telemetry — never break the run */ }
    // bumpRetry ONLY on the park (unchanged from the original per-site behavior).
    if (park) { try { await deps.bumpRetry?.(project, leaf.id); } catch { /* never break the park */ } }
    return { park, findings: synthProseFindings(reason) };
  };

  // G12: Snapshot untracked files BEFORE the first writing node so we can later
  // distinguish files the leaf created (new) from pre-existing junk. Declared here so
  // it's available to all nested functions. Will be populated before the ATTEMPT loop.
  let untrackedAtStart: string[] = [];

  // G12: Declared scope for commit scope computation. Populated after the blueprint is loaded.
  let declaredFiles: string[] = [];

  // Whether a PROJECT-DECLARED mechanical gate actually ran for the deciding review.
  // null = the gate was never evaluated (parked before the loop). false = pass without a
  // command running (undeclared, misconfigured-early, or an unwired seam) — the LLM alone
  // decided. See LeafGateResult.declared.
  let gateDeclared: boolean | null = null;

  // Payload B (retryContext): prior run's terminal info for retry-context block.
  // Populated before the attempt loop via lazy import of ledger-stats.
  let priorRun: PriorRunInput | null = null;

  // Per-(project, node-kind) model + effort overrides, resolved once per run.
  // model  : per-kind override → NODE_PROFILE default.
  // effort : per-kind override → per-project blanket (getProjectEffort) →
  //          MERMAID_NODE_EFFORT env → per-kind NODE_PROFILE default.
  const nodeOverrides = deps.nodeProfileOverrides ?? listNodeProfileOverrides(project);
  const projectEffort = getProjectEffort(project);
  // Cross-dispatch wall history: escalation decision driver for implement attempts.
  const wall = deps.wallHistory ?? getLeafWallHistory(leaf.id);
  // Tier escalation plan holder: latched by buildSpec's implement branch to compose
  // the attempt ladder (escalateImplementModel) with the wall-based tier bump.
  let tierPlan: TierEscalationPlan | null = null;
  // Escalation set: kinds whose model has been bumped to the blueprint model
  // (a higher tier) instead of its normal pinned model. Set on an implement start-failure
  // so the in-place retry runs stronger — coherent everywhere nodeModel is used (spec
  // build, ledger recordedModel, setInflight).
  const escalatedKinds = new Set<LeafNodeKind>();
  // The in-place start-failure escalation target: a per-project 'blueprint' override still wins
  // (so a project that repins blueprint to opus escalates to that), but the default is the
  // explicit ESCALATION_MODEL — NOT NODE_PROFILE.blueprint.model, which is sonnet and would
  // make the escalation a no-op for kinds already pinned at sonnet.
  const resolveEscalationModel = (): string => {
    const bpTools = NODE_PROFILE['blueprint'].allowedTools;
    return resolveNodeModel(project, 'blueprint', resolveNodeProvider(project, 'blueprint', bpTools), ESCALATION_MODEL);
  };
  const nodeModel = (kind: LeafNodeKind, allowedTools = NODE_PROFILE[kind].allowedTools, depth?: ReviewDepth): string => {
    if (depth === 'heavy') {
      return resolveEscalationModel();
    }
    if (kind === 'review' && leaf.tier === 'small') {
      return NODE_PROFILE.implement.model; // 'sonnet' — demote off opus for the small tier
    }
    if (escalatedKinds.has(kind)) {
      return resolveEscalationModel();
    }
    // TIER-SCOPED override: a `${kind}@${tier}` row in node_profile_override (e.g.
    // 'implement@small') beats the kind-wide row for leaves of that tier, so a project
    // can pin implement=sonnet for full-tier work while trialing a cheaper model on
    // small/test-pinned leaves — the measured-A/B lever for model economics. Escalation
    // (start-failure retry) still wins above: a failing cheap-model start retries strong.
    const tierScoped = leaf.tier ? nodeOverrides[`${kind}@${leaf.tier}`]?.model : undefined;
    if (tierScoped) return tierScoped;
    const kindWide = nodeOverrides[kind]?.model;
    if (kindWide) return kindWide;
    const provider = resolveNodeProvider(project, kind, allowedTools);
    return resolveNodeModel(project, kind, provider, NODE_PROFILE[kind].model);
  };
  const nodeEffort = (kind: LeafNodeKind, depth?: ReviewDepth): EffortLevel => {
    const baseEffort = nodeOverrides[kind]?.effort ?? projectEffort ?? ENV_NODE_EFFORT ?? NODE_PROFILE[kind].effort;
    if (depth === 'heavy') {
      const effortRank: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
      const currentIdx = effortRank.indexOf(baseEffort);
      const xhighIdx = effortRank.indexOf('xhigh');
      return currentIdx >= xhighIdx ? baseEffort : 'xhigh';
    }
    return baseEffort;
  };

  // NODE_BUDGET (20) is the runaway ceiling sized for the FLOOR (≤6 nodes/2 attempts). The
  // WAVES path legitimately spends ~tasks + files×~3 nodes (research per task, then
  // implement/verify/fix per file) — a 6-file leaf needs ~22, which the floor ceiling
  // false-kills mid-wave (the L4 node-budget-exhausted). Raise the ceiling size-aware for
  // waves (computed from the manifest below), capped so a true runaway is still bounded.
  // A test-supplied nodeBudget is honored verbatim (so budget-ceiling tests stay
  // deterministic). Mutable so the waves branch can lift it once the manifest is known.
  const budgetState = { value: deps.nodeBudget ?? NODE_BUDGET, raises: 0 };
  /** TRUE while still within the master node budget. */
  const checkBudget = (): boolean => state.nodesSpent <= budgetState.value;

  /** Single wrapper used for EVERY invokeNode call: increment BEFORE the spawn
   *  (so a hanging node still counts toward the budget), invoke, then a best-effort
   *  ledger write. */
  const runNode = async (
    kind: LeafNodeKind,
    spec: NodeSpec,
    /** P4a R1: optional verdict/outcome to stamp on THIS node's ledger row (the
     *  review node passes its parsed verdict; the terminal return path also stamps
     *  the leaf's final outcome here so no extra row is emitted). */
    extra?: { verdict?: 'pass' | 'fail' | null; leafOutcome?: LeafRunResult['outcome'] | null },
  ): Promise<NodeResult> => {
    // Cooperative abort — before the spawn. Catches an ancestor drop / hold / claim
    // loss at the node boundary so we never launch a node the daemon has already
    // decided to stop (E1's SIGTERM handles a LIVE node; this handles between-nodes).
    const preAbort = deps.shouldAbort?.(project, leaf.id);
    if (preAbort) throw new LeafAborted(preAbort);
    state.nodesSpent += 1;
    // LIVE signal: mark the leaf as running THIS node before the (slow) spawn, clear it
    // the instant the node returns — so the in-flight node is visible cross-process.
    deps.setInflight?.({ project, leafId: leaf.id, epicId, nodeKind: kind, model: nodeModel(kind), attempt: state.attempt });
    // DURABLE budget checkpoint (slice 1b): nodesSpent was already incremented above,
    // so persist it BEFORE the slow spawn — a kill mid-node then recovers the spend
    // (the node counts toward budget whether or not it finishes, matching checkBudget).
    deps.persistResume?.({ project, leafId: leaf.id, nodesSpent: state.nodesSpent, phase: kind, attempt: state.attempt, epicBaseSha: deps.epicBaseSha });
    // PER-NODE provider routing (PR-2). Resolve provider from the node's allowlist (MCP →
    // forced claude) + config; default claude = no behaviour change. For grok, set the spec
    // model to the kind's grok default so buildGrokArgv resolves a grok `-m` (not a claude
    // alias). The recorded (provider, model) reflects what actually ran (Grok review note).
    const provider = resolveNodeProvider(project, kind, spec.allowedTools);
    // Three lanes: grok-build (CLI coding proxy), grok-api (public api.x.ai → grok-4.3 reasoner,
    // read-only loop for review/blueprint), else claude. Each sets the spec model + ledger model
    // so the recorded (provider, model) reflects what actually ran.
    let invoker: NodeInvoker;
    let effSpec = spec;
    let recordedModel: string;
    if (provider === 'grok-build') {
      invoker = deps.grokInvoker ?? GrokNodeInvoker;
      // Honor the per-kind model override (UI matrix) so e.g. implement can be pinned to
      // grok-build (grok-build-0.1) instead of the composer-fast kind default.
      const grokModel = grokModelForKind(project, kind);
      effSpec = { ...spec, model: grokModel };
      recordedModel = grokModel;
    } else if (provider === 'grok-api') {
      invoker = deps.xaiInvoker ?? XaiApiNodeInvoker;
      effSpec = { ...spec, model: xaiApiLedgerModel(kind) };
      recordedModel = xaiApiLedgerModel(kind);
    } else {
      invoker = deps.invoker;
      recordedModel = spec.model!;
    }
    // NOTE (bug 0f1df3d2): do NOT clear the inflight row here. It is set per-node
    // (above) so nodeKind stays fresh, but the row must SPAN the whole run — including
    // the between-nodes window — so the daemon's orphan-reclaim guard (isLeafInflightLive)
    // never reclaims a live leaf mid-run. The single clear lives in finishWith.
    // Opt OUT of the invoke boundary's default-on spend capture: the leaf executor records its node
    // spend richly itself (deps.recordNode below, with per-leaf/epic keying). Without this the boundary
    // would write a SECOND, coarser row per node and double-count leaf burn in the gauge.
    const res: NodeResult = await invoker.invoke({ ...effSpec, skipAutoLedger: true });
    // Cooperative abort — after the spawn returns. A `killLeafSubtree` SIGTERM (E1)
    // makes the node return non-zero; without this check the revise/WAVES loop reads
    // that as a plain node failure and spawns the NEXT node instead of stopping.
    // Checked BEFORE the start-failure probe so a killed node is never misread as one.
    const postAbort = deps.shouldAbort?.(project, leaf.id);
    if (postAbort) throw new LeafAborted(postAbort);
    if (isNodeStartFailure(res)) {
      res.startFailure = { provider, model: recordedModel, detail: (res.text ?? res.parseError ?? '').slice(0, 300) };
    }
    try {
      deps.recordNode({
        project,
        todoId: leaf.id,
        session: sessionKey,
        epicId,
        leafId: leaf.id,
        nodeKind: kind,
        provider,
        model: recordedModel,
        nodesSpent: 1,
        authMode: res.authMode,
        exitCode: res.exitCode,
        durationMs: res.durationMs,
        rateLimited: res.rateLimited,
        inputTokens: res.usage?.inputTokens,
        outputTokens: res.usage?.outputTokens,
        cacheReadTokens: res.usage?.cacheReadTokens,
        cacheCreationTokens: res.usage?.cacheCreationTokens,
        costUsd: res.usage?.costUsd,
        steps: res.usage?.numTurns,
        parseError: res.startFailure ? `node-start-failure (provider=${provider}, model=${recordedModel}): ${res.parseError ?? ''}` : (res.parseError ?? null),
        verdict: extra?.verdict ?? null,
        leafOutcome: extra?.leafOutcome ?? null,
        // Persist the node's final message so a stuck/rejected leaf is diagnosable
        // (and UI-surfaceable) after the fact — the tsc error, review reason, etc.
        outputText: res.text ?? null,
        // C2: persist recorded commands for evidence gating
        commands: res.commands?.length ? JSON.stringify(res.commands) : null,
      });
    } catch {
      /* ledger is telemetry — never break the run */
    }
    // C2: accumulate commands in-memory for the review-pass gate
    if (res.commands?.length) {
      recordedCommands.push(...res.commands);
    }
    // DEFENSE-IN-DEPTH (6bc2dc36): a spawn whose CWD (the lane worktree) vanished mid-run
    // fails ENOENT for EVERY provider; the revise/WAVES loop would otherwise cascade ~14
    // such nodes burning the budget before the review notices. The per-project worktree
    // lock is the root-cause fix; this is the backstop — on the FIRST ENOENT into a
    // now-missing cwd, fail LOUD so the leaf pauses/escalates instead of churning.
    if (
      res.exitCode != null && res.exitCode < 0 &&
      /ENOENT/.test(res.parseError ?? '') &&
      effSpec.cwd && !existsSync(effSpec.cwd)
    ) {
      throw new Error(`worktree-missing: lane worktree ${effSpec.cwd} was removed mid-run (node ${kind})`);
    }
    return res;
  };

  /** P4a R1: stamp the leaf's terminal outcome (and, when known, the deciding
   *  review verdict) onto a lightweight marker row so the read-side `getLeafRun`
   *  can surface finalOutcome/reviewVerdict. Best-effort telemetry — a marker write
   *  must never break the run. Kept additive: it does NOT touch the prior node rows.
   *  Carries nodesSpent:0 so it doesn't inflate the budget rollup. */
  const recordOutcome = (
    outcome: LeafRunResult['outcome'],
    verdict: 'pass' | 'fail' | null = null,
    detail?: { reason?: string; pendingReason?: string; gateReasons?: string[] },
  ): void => {
    try {
      deps.recordNode({
        project,
        todoId: leaf.id,
        session: sessionKey,
        epicId,
        leafId: leaf.id,
        nodeKind: 'outcome',
        model: '',
        nodesSpent: 0,
        verdict,
        leafOutcome: outcome,
        // ATOMIC terminal record (§4a): one JSON blob, written once, the single source
        // for the acceptance decision — never re-derived downstream.
        outcomeDetail: JSON.stringify({
          effectiveOutcome: outcome,
          reviewVerdict: verdict,
          pathTaken: state.pathTaken,
          tier: leaf.tier ?? 'full',
          attempts: state.attempt,
          nodesSpent: state.nodesSpent,
          ...(gateDeclared !== null ? { gateDeclared } : {}),
          ...(detail?.reason ? { reason: detail.reason } : {}),
          ...(detail?.pendingReason ? { pendingReason: detail.pendingReason } : {}),
          ...(detail?.gateReasons?.length ? { gateReasons: detail.gateReasons } : {}),
        }),
      });
    } catch {
      /* telemetry — never break the run */
    }
  };

  /** Park BLOCKED: route a final 'rejected' through the SAME gate so dependents
   *  settle, raise an escalation card, and return the blocked result. */
  const parkBlocked = async (
    reason: string,
    verdict: 'pass' | 'fail' | null = null,
  ): Promise<LeafRunResult> => {
    // Refund the dispatch-time retryCount bump for infra parks that did zero work.
    if (reason === 'epic-base-moved') {
      try { await deps.refundRetry?.(project, leaf.id); } catch { /* telemetry — never break the park */ }
    }
    // crit 6 AUTO-REVERT: if this leaf optimistically landed (small/test-pinned merged
    // BEFORE review), any terminal park — a real post-land review FAIL, a mechanical-gate
    // regression on a revised pass, an exhausted prose-retry, an infra incident — must undo
    // that merge so failed-review code is NEVER left stranded on the epic branch. Revert
    // ONLY this leaf's merge commit, record an AUDITABLE REASON CARD (friction row naming
    // the leaf, the reverted sha, and the finding), and re-tag the park reason. Done once
    // (clears optimisticallyLanded) so a downstream park can't double-revert.
    if (optimisticallyLanded && optimisticMergeSha) {
      const mergeSha = optimisticMergeSha;
      optimisticallyLanded = false;
      let revertSha: string | undefined;
      // VERIFIED revert: a throw OR an unverified/failed revert must NEVER be swallowed —
      // that is exactly how rejected code was left stranded on the epic branch with only a
      // friction row to show for it. `revertOk` requires BOTH `reverted===true` AND the
      // helper's own content verification (see WorktreeManager.revertEpicMerge/diff check).
      let revertOk = false;
      let revertFailDetail: string | undefined;
      try {
        const rev = await deps.revertEpicMerge?.(sessionKey, epicId, leaf.id, mergeSha, reason);
        revertSha = rev?.revertSha;
        revertOk = rev?.reverted === true && rev?.verified === true;
        if (rev && !revertOk) revertFailDetail = rev.reverted ? 'revert ran but verification found the merge still present' : (rev.error ?? 'git revert failed');
      } catch (e) {
        revertFailDetail = e instanceof Error ? e.message : String(e);
      }
      try {
        deps.recordNode({
          project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
          nodeKind: revertOk ? 'optimistic-land-reverted' : 'optimistic-land-revert-failed',
          nodesSpent: 0, verdict: 'fail',
          outcomeDetail: JSON.stringify({ mergeSha, revertSha, reason, tier: leaf.tier ?? 'full', ...(revertFailDetail ? { revertFailDetail } : {}) }),
          outputText: revertOk
            ? `optimistic-land-reverted: reverted ${mergeSha}${revertSha ? ` via ${revertSha}` : ''} — ${reason}`
            : `optimistic-land-revert-failed: could not revert ${mergeSha} on ${epicBranch} — ${revertFailDetail ?? 'unknown'} — ${reason}`,
        });
      } catch { /* telemetry — never break the park */ }
      try {
        await recordFriction(project, {
          todoId: leaf.id, session: sessionKey, layer: 'orchestration',
          retryReason: revertOk ? 'optimistic-land-reverted' : 'optimistic-merge-revert-failed',
          detail: revertOk
            ? `Optimistically-landed leaf "${leaf.title ?? leaf.id}" (tier=${leaf.tier ?? 'full'}) reverted: post-land review/gate FAIL. Reverted merge ${mergeSha}${revertSha ? ` via ${revertSha}` : ''}. Finding: ${reason}`
            : `Optimistically-landed leaf "${leaf.title ?? leaf.id}" (tier=${leaf.tier ?? 'full'}) FAILED TO REVERT merge ${mergeSha} on epic branch ${epicBranch} — ${revertFailDetail ?? 'unknown'}. Rejected code may still be on the epic branch. Finding: ${reason}`,
        });
      } catch { /* friction store best-effort — never break the park */ }
      if (!revertOk) {
        // NEVER swallow: raise a hard blocker naming the epic branch and the unreverted
        // mergeSha so a human/conductor can hand-verify/hand-revert immediately.
        deps.escalate({
          project, session: sessionKey, kind: 'blocker', todoId: leaf.id,
          questionText:
            `OPTIMISTIC-MERGE REVERT FAILED for "${leaf.title ?? leaf.id}" — merge ${mergeSha} on epic branch ` +
            `${epicBranch} may still be present (rejected code not confirmed removed). ${revertFailDetail ?? ''} ` +
            `Manual verification/revert required before this epic can safely land.`,
        });
        reason = `optimistic-merge-revert-failed: ${reason}`;
      } else {
        reason = `optimistic-land-reverted: ${reason}`;
      }
    }
    recordOutcome('blocked', verdict, { reason });
    // Land the reject intent DURABLY before the slow gate so a mid-gate process
    // restart can't reclaim+re-run this leaf (reclaimNow refuses acceptanceStatus
    // 'rejected'). complete() re-stamps it idempotently below.
    // OWNERSHIP-CAS (bug aadd927b): markRejecting only stamps if this run still owns the
    // todo. FALSE ⇒ a concurrent run already took it terminal (e.g. accepted) — this is a
    // trailing/duplicate run (the classic case: merge-to-epic-failed because the accepted
    // run already reaped the worktree). DISCARD the blocked outcome: do NOT clobber the
    // todo to rejected, do NOT escalate a spurious blocker. Mirrors completeTodo's E2 skip.
    let owned: void | boolean = true;
    try { owned = await deps.markRejecting?.(project, leaf.id); } catch { /* best-effort pre-stamp */ }
    if (owned === false) {
      return finishWith({ outcome: 'blocked', attempts: state.attempt, nodesSpent: state.nodesSpent, reason: `discarded-not-owned: ${reason}` });
    }
    try {
      await deps.complete(project, leaf.id, 'rejected');
    } catch {
      /* gate funnel best-effort on the blocked path */
    }
    deps.escalate({
      project,
      session: sessionKey,
      kind: 'blocker',
      todoId: leaf.id,
      questionText:
        `Leaf-executor parked "${leaf.title ?? leaf.id}" — ${reason} ` +
        `(attempts=${state.attempt}, nodesSpent=${state.nodesSpent}).`,
    });
    return finishWith({ outcome: 'blocked', attempts: state.attempt, nodesSpent: state.nodesSpent, reason });
  };

  /** A node that could not START is an INCIDENT, not a finding. Park 'error', escalate
   *  naming the (provider, model) pair, spawn NO fix node, and NEVER stamp the todo
   *  'rejected' — the work was never judged. */
  const parkNodeStartFailure = async (kind: LeafNodeKind, res: NodeResult): Promise<LeafRunResult> => {
    const sf = res.startFailure!;
    const reason = `node-could-not-start: ${kind} node failed in ${res.durationMs}ms with zero tokens — provider='${sf.provider}' model='${sf.model}'. ${sf.detail}`;
    recordOutcome('blocked', null, { reason });
    // Circuit-break the start-failure retry amplifier (bug a8935a16): a start failure that
    // released → re-claimed would spin up to MAX_CLAIM_RETRIES times, each spin eating a full
    // startup window (the 4×600s incident). Once the leaf has already burned its one retry
    // (retryCount ≥ MAX_START_FAILURE_RETRIES), durably HOLD it instead of releasing for
    // re-claim, so a node that STILL can't start stops spinning. Falls back to
    // bump+release for the first offence (one retry) and when holdLeaf is unwired.
    const priorRetries = leaf.retryCount ?? 0;
    const held =
      priorRetries >= MAX_START_FAILURE_RETRIES && deps.holdLeaf != null
        ? await (async () => {
            try {
              return (await deps.holdLeaf!(project, leaf.id,
                `start-failure-circuit-break: ${kind} node could not start ${priorRetries + 1}× — provider='${sf.provider}' model='${sf.model}'`)) === true;
            } catch { return false; /* best-effort — fall through to release */ }
          })()
        : false;
    if (!held) {
      try { await deps.bumpRetry?.(project, leaf.id); } catch { /* telemetry — never break the park */ }
      try { await deps.releaseClaim?.(project, leaf.id); } catch { /* best-effort */ }
    }
    const stableFacts =
      `node-could-not-start: ${kind} node failed with zero tokens — ` +
      `provider='${sf.provider}' model='${sf.model}'. ${sf.detail}`;
    deps.escalate({ project, session: sessionKey, kind: 'blocker', todoId: leaf.id,
      questionText: `Leaf-executor could not START the ${kind} node for "${leaf.title ?? leaf.id}" — ${stableFacts} Check the node-profile row for this project/kind: the model does not belong to the provider.` });
    return finishWith({ outcome: 'blocked', attempts: state.attempt, nodesSpent: state.nodesSpent, reason });
  };

  /** Yield a `paused` outcome — the executor's ENTIRE rate-cap response. It NEVER
   *  backs off, sleeps, or retries; it returns immediately with the resume state and
   *  the daemon (headless-breaker) owns all timing. Pause does NOT advance
   *  `state.attempt` (we `return` before the loop's `attempt += 1`), so the in-flight
   *  attempt is preserved as-is. */
  const pausedResult = (kind: LeafNodeKind, res: NodeResult): LeafRunResult => {
    recordOutcome('paused');
    return {
    outcome: 'paused',
    attempts: state.attempt,
    nodesSpent: state.nodesSpent,
    reason: 'rate-limited',
    paused: {
      atNode: kind,
      attempt: state.attempt,
      nodesSpent: state.nodesSpent,
      capReset: res.capReset,
    },
    };
  };

  /** Synthesize a paused outcome for a `wm.ensure()` throw classified as the transient
   *  worktree-add base-branch race (crit-11) — no live `NodeResult` exists for a throw out
   *  of worktree creation, so fabricate one exactly like the reattach-blueprint synthetic
   *  OK result elsewhere in this file. */
  const pausedForWorktreeAddFault = (kind: LeafNodeKind): LeafRunResult =>
    pausedResult(kind, {
      ok: false, exitCode: 128, stdout: '', durationMs: 0, rateLimited: true,
      authMode: 'subscription', text: '', capReset: Date.now() + transientRetryAfterMs(),
    });

  const buildSpec = (
    kind: LeafNodeKind,
    cwd: string,
    blueprintText?: string,
    reviewFindings?: string,
    depth?: ReviewDepth,
  ): NodeSpec => {
    const injected = composeInjectedContext({ kind, project, epicId, flags: getInjectionFlags(project), attempt: state.attempt, priorRun });
    return {
      // The node's cwd IS the lane worktree — say so IN the prompt (the root cause of the
      // main-checkout write/test leak is that nothing ever wrote it down).
      prompt: buildNodePrompt(kind, leaf, blueprintText, reviewFindings, {
        worktree: cwd,
        mainCheckout: deps.mainCheckoutRoot ?? null,
      }),
      // Retry ladder + wall-based tier escalation: compose the attempt ladder with the
      // cross-dispatch wall bump so implement models escalate monotonically via both paths.
      model: kind === 'implement'
        ? (() => {
            const plan = planTierEscalation({
              wall,
              currentModel: escalateImplementModel(nodeModel('implement'), state.attempt),
              attempt: state.attempt,
            });
            tierPlan = plan;
            return plan.model;
          })()
        : nodeModel(kind, NODE_PROFILE[kind].allowedTools, depth),
      effort: nodeEffort(kind, depth),
      allowedTools: NODE_PROFILE[kind].allowedTools,
      // Strip the project's MCP server (.mcp.json) from any node that can't call an mcp__
      // tool — build nodes use only built-ins, so the ~200-tool surface is dead context.
      strictMcpConfig: !NODE_PROFILE[kind].allowedTools.includes('mcp__'),
      mcpConfig: NODE_PROFILE[kind].allowedTools.includes('mcp__') ? mcpConfigFor(config.PORT) : undefined,
      cwd,
      leafId: leaf.id,
      epicId,
      project, // E1: recorded in the leaf-subprocess registry for per-project brake
      permissionMode: resolveNodePermissionMode(),
      transcriptPath: leafTranscriptPath(project, leaf.id),
      transcriptLabel: kind,
      appendSystemPrompt: injected || undefined,
      // Per-kind wall-clock cap (implement-class nodes get IMPLEMENT_TIMEOUT_MS);
      // undefined → the invoker's 600s default. Start-window stall detection unaffected.
      timeoutMs: NODE_PROFILE[kind].timeoutMs,
    };
  };

  /** SR-7: blueprint refresh spec for split children. Honors per-project overrides exactly
   *  like buildSpec, just uses a different (cheaper) model/effort default and the refresh prompt. */
  const buildRefreshSpec = (cwd: string, slice: InheritedSlice): NodeSpec => ({
    ...buildSpec('blueprint', cwd),
    prompt: buildBlueprintRefreshPrompt(leaf, slice.text, slice.files),
    model: nodeOverrides.blueprint?.model ?? BLUEPRINT_REFRESH_PROFILE.model,
    effort: nodeOverrides.blueprint?.effort ?? projectEffort ?? ENV_NODE_EFFORT ?? BLUEPRINT_REFRESH_PROFILE.effort,
  });

  /** Verify-pipeline NodeSpec (epic f5c7fc46) — mirrors buildSpec but uses buildVerifyPrompt
   *  and threads the resolved gate `verb` into both the prompt and (for driveexec) the per-leaf
   *  allowlist, so a non-default verb is referenced AND tool-allowlisted correctly (L3). */
  const buildVerifySpec = (
    kind: 'driveplan' | 'driveexec' | 'report',
    cwd: string,
    verb: string,
    planText?: string,
    gateFindings?: string,
  ): NodeSpec => ({
    prompt: buildVerifyPrompt(kind, leaf, planText, gateFindings, verb),
    model: nodeModel(kind),
    effort: nodeEffort(kind),
    // driveexec is constrained to the RESOLVED verb's MCP tool (not the static default).
    allowedTools:
      kind === 'driveexec'
        ? `Read Write Bash ${verbMcpTool(verb)}`
        : NODE_PROFILE[kind].allowedTools,
    strictMcpConfig: true,
    mcpConfig: (kind === 'driveexec' || kind === 'report') ? mcpConfigFor(config.PORT) : undefined,
    cwd,
    leafId: leaf.id,
    epicId,
    project, // E1: recorded in the leaf-subprocess registry for per-project brake
    permissionMode: resolveNodePermissionMode(),
    // The execute node runs a heavy CAD build — give it a longer wall-clock cap (L4: the
    // default 600s killed it mid-build). Other verify nodes use the default.
    ...(kind === 'driveexec' ? { timeoutMs: VERIFY_EXEC_TIMEOUT_MS } : {}),
  });

  /**
   * VERIFY pipeline (epic f5c7fc46): plan(LLM authors AssemblyBuildPlan) → execute(node
   * constrained to the deterministic gate verb, captures raw result) → gate(executor parses
   * the verb's TRUE verdicts) → report(LLM writes+commits findings, files one todo each).
   * The LLM authors + reports (both safe, committable) but is OUT of the stateful execution
   * loop — the deterministic verb does the CAD (Grok's key point). The deliverable is a
   * COMMITTED report, so it reuses the SAME mergeToEpic/complete machinery as the code path
   * (no no-commit escape hatch). A failing DOMAIN gate is not an executor failure — it is the
   * finding the leaf exists to surface, so it still reports + accepts; only an INFRA error
   * (verb crashed / no parseable verdict) parks blocked. L3: the gate is a PLUGGABLE
   * {verb, command} ({@link resolveVerifyGate}) — the verb result AND an optional shell
   * command gate (e.g. pytest) compose into the findings. Spends 3–4 nodes through the
   * shared budget/runNode.
   */
  /** SHARED REPORT TAIL for the non-authoring shapes (verify + review). The committed
   *  report .md has already been written into the worktree; merge it onto the epic branch
   *  (so the completion gate's work-committed re-verify sees committed work, exactly like
   *  the code path), then propose acceptance and record the terminal outcome. `gateVerdict`
   *  is informational telemetry — BOTH pass and fail ACCEPT (a finding is the deliverable,
   *  filed as todos, not a rejection). Only a merge failure parks blocked. */
  const finalizeReportLeaf = async (
    gateVerdict: 'pass' | 'fail',
    commitMessage: string,
  ): Promise<LeafRunResult> => {
    try {
      await deps.mergeToEpic(sessionKey, epicId, commitMessage, leaf.id, {
        declaredFiles: [],
        untrackedAtStart,
      });
    } catch (e) {
      return parkBlocked(
        `merge-to-epic-failed: ${e instanceof Error ? e.message : String(e)}`,
        gateVerdict,
      );
    }
    const g = await deps.complete(project, leaf.id, 'accepted');
    const effective = g.effective ?? 'accepted';
    const reason =
      effective === 'pending' ? 'gate-pending'
      : effective === 'rejected' ? 'gate-rejected'
      : undefined;
    recordOutcome(effective, gateVerdict, {
      reason,
      pendingReason: g.pendingReason,
      gateReasons: g.gateReasons,
    });
    return finishWith({
      outcome: effective,
      attempts: state.attempt,
      nodesSpent: state.nodesSpent,
      ...(reason ? { reason } : {}),
    });
  };


  // --- G2 EPIC BASE GATE ---------------------------------------------------------
  // A red base is the most important fact on a branch: EVERY leaf built on it inherits
  // its brokenness. Check it BEFORE the execution-mode dispatch so a red base starts
  // ZERO leaves of any shape and spends ZERO nodes (nodesSpent stays 0 in the terminal
  // record). Cached once per epic (deps.ensureBaseGreen) — this call is cheap on every
  // leaf after the first.
  const base = await deps.ensureBaseGreen?.();
  // BASE-REPAIR EXEMPTION (bug 65345589): an epic whose PURPOSE is greening a red base
  // lane is otherwise deadlocked by this very hold — its leaves ARE the fix for the lane
  // that holds them (observed: sixth-drain epic 6560e5e1 'Green the ^ui/ vitest lane',
  // every leaf parked epic-base-red on the lane it exists to repair). An epic explicitly
  // flagged `baseRepair` (set by conductor/planner/human — never auto-inferred) runs its
  // leaves anyway; each leaf's OWN gate still judges net-new-vs-base via the lazy
  // baseline machinery, so inherited base brokenness cannot land silently. The exemption
  // covers the red-base park only — a gate CONFIG error (could-not-run) still parks.
  const baseRepairEpic = base && base.status === 'fail'
    && !!(deps.getEpicTodo ? deps.getEpicTodo() : (leaf.parentId ? getTodo(project, leaf.parentId) : null))?.baseRepair;
  if (baseRepairEpic) {
    console.log(`[leaf-executor] base-red EXEMPT: epic ${(leaf.parentId ?? '').slice(0, 8)} is baseRepair — leaf ${leaf.id.slice(0, 8)} proceeds under net-new gate semantics`);
  }
  if (base && base.status !== 'pass' && !baseRepairEpic) {
    const head = base.status === 'error' ? 'epic-base-gate-could-not-run' : 'epic-base-red';
    const cmd = base.command ?? 'gate';
    // Finding 3: a leaf parking on a CACHED verdict (fresh:false) escalates nothing — it
    // must still say WHY. The reason is the leaf's only durable trace, so it carries the
    // failing command and a short output tail, not a bare "epic-base-red".
    const tail = lastLines(base.output, 10);
    const reason = tail ? `${head}: ${cmd}\n--- output (tail) ---\n${tail}` : `${head}: ${cmd}`;
    if (base.fresh) {
      deps.escalate({
        project,
        session: sessionKey,
        kind: 'blocker',
        todoId: leaf.id,
        questionText:
          `Epic base is RED — no leaf on ${epicBranch} can be trusted, so NONE will start.\n` +
          `failing command: ${cmd}\n` +
          `--- output (tail) ---\n${lastLines(base.output, 40)}\n---\n` +
          `Fix the base and commit the fix to ${epicBranch}. The cached verdict is keyed to the ` +
          `base commit it examined, so moving the base invalidates it: the next leaf re-runs the ` +
          `gate automatically. No manual cache-clearing step exists or is needed.`,
      });
    }
    return parkBlocked(reason);
  }

  // Friction 552f95c2: the latest attempt's write-leak snapshot + lane cwd, hoisted so the
  // ABORT path (outer LeafAborted catch) can sweep leaked main-checkout writes too — a run
  // killed mid-implement otherwise never sweeps, and later runs grandfather its leak forever.
  let lastRootSnap: { cwd: string; snap: RootSnapshot } | null = null;

  // Cooperative abort: everything past this point can spawn nodes via `runNode`, which
  // throws LeafAborted at either node boundary once the daemon has stopped the run
  // (ancestor drop / hold / claim loss). Catch it here — a SINGLE funnel for every
  // pipeline (code/verify/review) — and finish cleanly with NO completion, merge, or
  // escalation of our own; the aborter already decided the todo's terminal state.
  try {
  // EXECUTION-MODE DISPATCH. A 'verify' leaf (epic f5c7fc46) runs the non-code dogfood
  // pipeline (plan → deterministic build_assembly_plan → domain gate → committed report);
  // a 'review' leaf (epic d8ac1a18) runs the completeness-review pipeline (one judgment
  // node over the epic union diff → committed report → gap todos). Both are NON-authoring
  // shapes — force-fitting either into blueprint→implement→tsc is exactly the build123d T14
  // failure (vacuous "TSC: CLEAN") and the reviewer-strands-the-epic failure this dispatch fixes.
  if (leafExecutionMode(leaf) === 'verify') {
    const ctx: LeafRunContext = { project, leaf, deps, epicId, epicBranch, sessionKey,
      state, budgetState, escalatedKinds, checkBudget, runNode, parkBlocked,
      parkNodeStartFailure, pausedResult, pausedForWorktreeAddFault, finalizeReportLeaf,
      buildVerifySpec, nodeModel, nodeEffort, untrackedAtStart };
    return await runVerifyPipeline(ctx);
  }
  if (leafExecutionMode(leaf) === 'review') {
    const ctx: LeafRunContext = { project, leaf, deps, epicId, epicBranch, sessionKey,
      state, budgetState, escalatedKinds, checkBudget, runNode, parkBlocked,
      parkNodeStartFailure, pausedResult, pausedForWorktreeAddFault, finalizeReportLeaf,
      buildVerifySpec, nodeModel, nodeEffort, untrackedAtStart };
    return await runReviewPipeline(ctx);
  }

  // RESUME: SKIP-TO-GATE (slice 2). A prior (killed) run already committed this
  // leaf's work onto the epic branch but died before the acceptance gate finished.
  // Re-running the whole leaf would be pure waste — just run the gate, which
  // re-verifies the already-committed work. Safe regardless of further epic advance.
  if (deps.resumePlan?.mode === 'skip-to-gate') {
    // GATE EQUIVALENCE (crit3): `deps.complete(...,'accepted')` is only a REQUEST —
    // it routes through handleWorkerComplete → resolveCompletion({runGate,
    // verifyWorkCommitted}), the SAME authoritative mechanical+llm gate the fresh
    // completion path (:2384) and the report-leaf path (:1705) use. So skip-to-gate
    // still resolves to `gate.effective` 'rejected'/'pending' on a red gate and never
    // grants a free 'accepted'. The fresh path's separate `deps.runGate` (:2234) only
    // feeds the REVIEW node, which skip-to-gate deliberately skips — it is NOT the
    // authoritative gate and its absence here changes no verdict.
    const gate = await deps.complete(project, leaf.id, 'accepted');
    const effective = gate.effective ?? 'accepted';
    const reason =
      effective === 'pending' ? 'gate-pending'
      : effective === 'rejected' ? 'gate-rejected'
      : 'resumed-skip-to-gate';
    recordOutcome(effective, null, { reason, pendingReason: gate.pendingReason, gateReasons: gate.gateReasons });
    return finishWith({ outcome: effective, attempts: state.attempt, nodesSpent: state.nodesSpent, reason });
  }

  // SR-7: a split child reuses its parent's durable plan; its blueprint node is a cheap
  // sonnet REFRESH. Missing/under-specified plan ⇒ null ⇒ the full opus blueprint.
  const inherited = resolveInheritedSlice(leaf, deps.restoreBlueprint);

  // ATTEMPT loop — n in [0, ATTEMPT_CAP). A FRESH worktree off the epic tip every
  // iteration (no surgical reuse of the prior attempt's edits — that's P6).
  // IN-RUN blueprint carry (token-burn lever bfc915dc): a SUCCESSFUL blueprint from a prior
  // attempt of THIS run is reused by later attempts instead of re-running the ~opus blueprint
  // node. The epic base is fixed for the run, so the plan stays valid; a fresh worktree still
  // reuses ONLY the plan text, never partial work. Only set after a good blueprint, so a
  // blueprint-failure attempt still re-runs it. Complements the cross-dispatch reattach.
  let carriedBlueprint: string | null = null;
  // C2: non-fatal unbacked-claim warning from the review pass — carried forward for recordOutcome.
  let unbackedNote: string | undefined;
  // G3 retained-mode observability: set when grounding ran in retained mode (empty
  // change-set, worktree-validated citations) so the accept is auditable in the ledger.
  let groundingNote: string | undefined;
  // ADVISORY cite-check (never gates): flag a review citing an unknown/inactive constraint id.
  let constraintCiteNote: string | undefined;
  // SAME-WALL-TWICE: the final review findings of the PREVIOUS failed attempt — a fresh
  // attempt that dies on substantially the same findings parks with the fork named.
  let lastAttemptFindings = '';
  // crit 4 (contested card): how many times a GREEN-mech falsifiable FAIL came back UNCOVERED
  // (declared tests do not flip base→branch), and whether we already raised the bounded-wait
  // contested-accept card. On the 2nd uncovered-contested cycle (the same-wall analog) we raise
  // ONE card instead of silently parking; accept → land (via reviewAdvisory), reject/timeout →
  // keep gating (today's park). Run-scoped so the count spans attempts.
  let uncoveredContestedSeen = 0;
  let contestedCardRaised = false;

  // Payload B (retryContext): capture the PRIOR run's terminal BEFORE any node of THIS dispatch
  // is recorded, so getLeafRun's latest-run scoping returns the prior dispatch's failure. Lazy
  // import breaks the static cycle (ledger-stats imports NODE_BUDGET from leaf-executor).
  try {
    const { getLeafRun } = await import('./ledger-stats');
    const pr = getLeafRun(leaf.id);
    if (pr) priorRun = { terminal: pr.terminal ?? null, reviewVerdict: pr.reviewVerdict, finalOutcome: pr.finalOutcome };
  } catch { priorRun = null; }

  for (state.attempt = 0; state.attempt < ATTEMPT_CAP; ) {
    state.attempt += 1; // 1-based count for telemetry/escalation
    const isLastAttempt = state.attempt >= ATTEMPT_CAP;

    // REBASE-CONTINUE (hot-trunk starvation): On the FIRST attempt of a resumed run
    // whose implement phase already completed, try to resume the EXISTING lane worktree
    // and reintegrate the moved base into it rather than forking fresh. This avoids
    // redispatching logic and lets a completed implement+review cycle run immediately.
    const rebaseContinuing = state.attempt === 1 && deps.resumePlan?.mode === 'rebase-continue';
    let reint: ReintegrateBaseResult | undefined;
    let wt: any;
    let cwd: string;

    if (rebaseContinuing) {
      reint = await deps.reintegrateBase?.(sessionKey, epicBranch);
      if (reint?.integrated === true && !reint.conflict && reint.wt) {
        // Successful reintegration — use the resumed worktree. Keep it alive even
        // if a base-moved park follows (set flag so finishWith skips the reap).
        wt = reint.wt;
        cwd = wt.path;
        keepWorktreeOnBaseMovedPark = true;
      } else {
        // Rebase failed/skipped — fall back to the fresh-fork path.
        try {
          wt = await deps.wm.ensure(sessionKey, { baseBranch: epicBranch, fresh: true });
        } catch (e) {
          if (e instanceof Error && classifyWorktreeAddFault(e.message)) {
            return pausedForWorktreeAddFault('blueprint');
          }
          throw e;
        }
        cwd = wt.path;
      }
    } else {
      // Normal path — fork a fresh worktree off the current epic tip.
      try {
        wt = await deps.wm.ensure(sessionKey, { baseBranch: epicBranch, fresh: true });
      } catch (e) {
        if (e instanceof Error && classifyWorktreeAddFault(e.message)) {
          return pausedForWorktreeAddFault('blueprint');
        }
        throw e;
      }
      cwd = wt.path;
    }

    // BASE-FRESHNESS PRE-CHECK: a cheap deterministic git probe BEFORE this attempt's
    // first node spends anything. Real incident: a stale/off-by-one base spent
    // blueprint+implement+review and was only THEN rejected at the gate for tsc errors in
    // files the leaf never touched — the drift was discovered too late (resume decisions /
    // the mechanical gate), after burning the whole node budget. `deps.wm.ensure(fresh:
    // true)` always forks off the LIVE epicBranch tip, so this should hold trivially; it
    // exists as a hard backstop against any future weakening of that guarantee (or a race
    // between the fork and this check). A probe THROW is treated exactly like a `null`
    // result (fail-open) — a broken probe must never park a healthy leaf.
    let baseIsAncestor: boolean | null = null;
    try {
      baseIsAncestor = (await deps.worktreeBaseFresh?.(cwd)) ?? null;
    } catch { /* probe error — fail-open, proceed */ }
    if (!classifyWorktreeBaseFreshness(baseIsAncestor).fresh) {
      // Reuse the SAME park mechanism (and the SAME 'epic-base-moved' reason tag) planResume
      // already uses for this class of drift — zero nodes spent, escalated exactly like the
      // G2 red-base case above, so a human/conductor reset_todo re-dispatches onto a fresh
      // worktree (always fresh — see the ensure() call above).
      return parkBlocked('epic-base-moved');
    }

    // RESUME: REATTACH-BLUEPRINT (slice 2). On the FIRST attempt of a resumed run
    // whose blueprint already completed (against an UNCHANGED epic base — guarded in
    // planResume), reuse the durable blueprint PLAN instead of re-running the ~4.5min
    // blueprint node. The worktree is still FRESH off the epic tip — we reuse only the
    // plan, never partial implementation — so this can't be "worse than fresh". If the
    // durable plan is gone, fall back to running the blueprint node normally.
    let bp: NodeResult;
    // Reuse a durable blueprint EITHER from a cross-dispatch resume (attempt 1) OR from a
    // prior attempt of THIS run (attempt > 1, in-run carry) — both write the plan to the
    // fresh worktree and skip the blueprint node (no node spent).
    const smallTier = leaf.tier === 'small';
    const reattach = state.attempt === 1
      && (deps.resumePlan?.mode === 'reattach-blueprint' || (rebaseContinuing && reint?.integrated));
    const inRunCarry = state.attempt > 1 && carriedBlueprint != null && carriedBlueprint.trim().length > 0;
    const restored = reattach ? (deps.restoreBlueprint?.(leaf.id) ?? null) : (inRunCarry ? carriedBlueprint : null);
    if ((reattach || inRunCarry) && restored && restored.trim()) {
      await deps.writeArtifact?.(cwd, blueprintPath(leaf), restored);
      // Synthetic OK result — no node spent (the whole point); text feeds the size
      // gate + implement just like a fresh blueprint node's final message.
      bp = { ok: true, exitCode: 0, stdout: restored, durationMs: 0, rateLimited: false, authMode: 'subscription', text: restored };
    } else if (smallTier) {
      const synthText = leaf.description ?? '';
      await deps.writeArtifact?.(cwd, blueprintPath(leaf), synthText);
      bp = { ok: true, exitCode: 0, stdout: synthText, durationMs: 0, rateLimited: false, authMode: 'subscription', text: synthText };
    } else {
      // BLUEPRINT — rate-limit check FIRST (a capped node produced no usable work; we
      // must not interpret its empty/error output as a FAIL nor advance the attempt).
      const bpSpec = inherited ? buildRefreshSpec(cwd, inherited) : buildSpec('blueprint', cwd);
      bp = await runNode('blueprint', bpSpec);
      if (bp.startFailure) return parkNodeStartFailure('blueprint', bp);
      if (bp.rateLimited) return pausedResult('blueprint', bp);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    }

    // L1-pilot finding (ce02d796): a blueprint node that FAILED (non-zero exit /
    // errored — NOT rate-limited, which is handled above) wrote no usable blueprint.
    // Proceeding to implement+review against a missing blueprint wastes two nodes on
    // a guaranteed review FAIL and burns the whole attempt. Give it ONE in-place
    // retry (still counted against the node budget); if it still fails, short-circuit
    // to a fresh attempt rather than running the rest of the pipeline blind.
    if (!bp.ok) {
      const bpSpec = inherited ? buildRefreshSpec(cwd, inherited) : buildSpec('blueprint', cwd);
      bp = await runNode('blueprint', bpSpec);
      if (bp.rateLimited) return pausedResult('blueprint', bp);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    }
    if (!bp.ok) {
      if (isLastAttempt) return parkBlocked('blueprint-node-failed');
      continue; // fresh attempt — never implement against a missing blueprint
    }

    // --- BLUEPRINT-BUDGET GATE --- (bounded re-emit on over-cap output tokens)
    // Only runs on genuine blueprint node runs (not synthetic reattach/in-run-carry paths,
    // which have durationMs === 0 and must never be charged a violation).
    if (!reattach && !inRunCarry && !smallTier) {
      const observedTokens = bp.usage?.outputTokens ?? 0;
      if (observedTokens > BLUEPRINT_OUTPUT_TOKEN_CAP) {
        const oversizedText = bp.text ?? bp.stdout ?? '';
        try {
          await deps.recordGateEval?.(project, {
            gate: 'blueprint-budget', leafId: leaf.id, inputText: oversizedText, changeSet: [],
            verdict: 'fail', reasons: `outputTokens=${observedTokens} > cap=${BLUEPRINT_OUTPUT_TOKEN_CAP}`,
          });
        } catch { /* telemetry-only */ }

        const summarizeSpec = { ...buildSpec('blueprint', cwd),
          prompt: buildBlueprintSummarizePrompt(leaf, oversizedText, BLUEPRINT_OUTPUT_TOKEN_CAP, observedTokens) };
        const reemit = await runNode('blueprint', summarizeSpec);
        if (reemit.startFailure) return parkNodeStartFailure('blueprint', reemit);
        if (reemit.rateLimited) return pausedResult('blueprint', reemit);
        if (!checkBudget()) return parkBlocked('node-budget-exhausted');

        if (reemit.ok) {
          const reemitTokens = reemit.usage?.outputTokens ?? Number.POSITIVE_INFINITY;
          const reemitText = await deps.readBlueprint?.(cwd, leaf).catch(() => undefined);
          const reemitBody = (reemitText && reemitText.trim() ? reemitText : reemit.text) ?? '';
          const reemitManifest = parseSizeManifest(reemitText, reemit.text);
          if (reemitManifest && reemitTokens < observedTokens) {
            bp = { ...reemit, text: reemitBody };
          }
        }
      }
    }

    // --- P5 SIZE GATE ---
    // Read the blueprint artifact (its trailing ```json size block) and derive the
    // manifest. Unparseable ⇒ null ⇒ the proven FLOOR (linear) fail-safe path.
    let manifestText = await deps.readBlueprint?.(cwd, leaf).catch(() => undefined);
    let manifest = parseSizeManifest(manifestText, bp.text);
    // Unconditional inline source (b77dd104): prefer the read-back .md, else the
    // blueprint node's own final-message text — so implement/review NEVER fall back to
    // globbing the shared blueprint dir (which leaked OTHER leaves' blueprints and made
    // the executor build the wrong feature). The blueprint node is instructed to emit
    // its full text as its final message, so bp.text is a reliable fallback.
    let blueprintBody = (manifestText && manifestText.trim() ? manifestText : bp.text) ?? '';

    // G8: Record the blueprint base SHA so a reusable blueprint survives when the run
    // checkpoint is cleared by a terminal outcome. Guarded to NOT rewrite on synthetic
    // reattach/in-run-carry results (those have durationMs === 0). Also seeds specJson
    // (the editable DiffContract) parsed from the just-derived blueprintBody.
    if (!reattach && !inRunCarry) {
      let seededContract = parseDiffContract(blueprintBody);

      // crit 8 — BOUNDED contract-underspecification repair (exactly once, fail-safe).
      // When the fresh contract omits a §4-required requirement kind for its leafKind,
      // re-prompt the blueprint node ONCE with the missing kind named. Adopt the repaired
      // contract only if the single retry produced a valid, no-longer-underspecified one;
      // otherwise DEGRADE to the v1 prose path (keep the blueprint we already have). Mirrors
      // the citability repair (2587-2647): same runNode guards, same re-read/rebind mechanics.
      if (!smallTier && seededContract) {
        const check = validateContractForKind(seededContract, seededContract.leafKind);
        if (check.underspecified) {
          const repairSpec = {
            ...buildSpec('blueprint', cwd),
            prompt: buildBlueprintRepairPrompt(leaf, blueprintBody, check.missingField),
          };
          const repair = await runNode('blueprint', repairSpec);
          if (repair.startFailure) return parkNodeStartFailure('blueprint', repair);
          if (repair.rateLimited) return pausedResult('blueprint', repair);
          if (!checkBudget()) return parkBlocked('node-budget-exhausted');
          if (repair.ok) {
            // Re-read/re-parse the reply ONCE, re-validate ONCE. Never re-prompt again.
            const reText = await deps.readBlueprint?.(cwd, leaf).catch(() => undefined);
            const reBody = (reText && reText.trim() ? reText : repair.text) ?? '';
            const reContract = parseDiffContract(reBody);
            if (reContract && !validateContractForKind(reContract, reContract.leafKind).underspecified) {
              // Repaired + valid ⇒ adopt. Rebinding these lets flows the repaired blueprint
              // into the per-attempt persistBlueprint (2555) and in-run carry (2549) below.
              const reManifest = parseSizeManifest(reText, repair.text);
              if (reText && reText.trim()) manifestText = reText;
              if (reManifest) manifest = reManifest;
              blueprintBody = reBody;
              seededContract = reContract;
            }
            // else: null OR still underspecified ⇒ DEGRADE to v1 — keep the first blueprint.
          }
        }
      }

      deps.persistBlueprintBase?.({
        project,
        leafId: leaf.id,
        epicBaseSha: deps.epicBaseSha,
        specJson: seededContract ? JSON.stringify(seededContract) : null,
        specRev: seededContract ? 0 : null,
        specSig: leafSpecSignature(leaf),
      });
    }

    // Carry this good blueprint forward so a later attempt of THIS run reuses it (in-run
    // reattach) instead of re-running the blueprint node. Prefer the read-back .md (carries
    // the size manifest); fall back to the node's final-message text.
    const carryText = manifestText && manifestText.trim() ? manifestText : bp.text;
    if (carryText && carryText.trim()) carriedBlueprint = carryText;

    // Persist the just-written blueprint per ATTEMPT (durable telemetry + UI source).
    // Best-effort: a throw must NEVER break the run. Only when we actually have the
    // .md text AND a parsed manifest (else there's nothing meaningful to surface).
    if (manifestText && manifest) {
      try {
        await deps.persistBlueprint?.({
          project,
          leaf,
          attempt: state.attempt,
          manifest,
          blueprintMd: manifestText,
        });
      } catch {
        /* persistence is durable-telemetry — never break the run */
      }
    }

    // --- L4 CITABILITY GATE (pre-implement) --------------------------------
    // Same predicate as the terminal G3 gate (validateReviewGrounding), paid for at the
    // only moment it is free: the criteria exist, the implement+review nodes do not yet.
    const declaredForCriteria = manifest
      ? [...new Set([...manifest.filesToCreate, ...manifest.filesToEdit, ...manifest.tasks.flatMap(t => t.files)])]
      : [];
    const criteriaTestOnly = declaredForCriteria.length > 0 && declaredForCriteria.every(isTestFilePath);

    // Prewarm base citations: extract all citations from the blueprint and resolve them
    // into the cache before the validator runs, so the sync predicate always hits prewarmed keys.
    const resolvedBaseCitations = new Map<string, boolean>();
    const prewarmBaseCitations = async (body: string) => {
      try {
        const citations = extractCitations(body);
        for (const { path, line } of citations) {
          const key = `${path}:${line}`;
          if (!resolvedBaseCitations.has(key)) {
            const result = await deps.citationLineExistsAtBase?.({ cwd, baseSha: deps.epicBaseSha, path, line }) ?? false;
            resolvedBaseCitations.set(key, result);
          }
        }
      } catch {
        // Fail-closed: if prewarm throws, unprewarmed keys resolve to false in the closure
      }
    };

    const citationExistsAtBase = (p: string, l: number) =>
      resolvedBaseCitations.get(`${p}:${l}`) ?? false;

    await prewarmBaseCitations(blueprintBody);
    let citability = validateCriteriaCitability(blueprintBody, declaredForCriteria, { testOnly: criteriaTestOnly, citationExistsAtBase });
    if (!smallTier) {
      try {
        await deps.recordGateEval?.(project, {
          gate: 'citability',
          leafId: leaf.id,
          inputText: blueprintBody,
          changeSet: declaredForCriteria,
          verdict: citability.status,
          reasons: citability.reasons.join('; '),
        });
      } catch { /* replay corpus is telemetry — never break the run */ }
      if (citability.status === 'uncitable') {
        // REPAIR ONCE: re-prompt the blueprint node with the offending criterion QUOTED and the
        // rule restated. Never silently drop or rewrite a criterion — it is the leaf's contract.
        const repairSpec = {
          ...buildSpec('blueprint', cwd),
          prompt: buildCriteriaRepairPrompt(leaf, blueprintBody, citability),
        };
        const repair = await runNode('blueprint', repairSpec);
        if (repair.startFailure) return parkNodeStartFailure('blueprint', repair);
        if (repair.rateLimited) return pausedResult('blueprint', repair);
        if (!checkBudget()) return parkBlocked('node-budget-exhausted');
        if (repair.ok) {
          const reText = await deps.readBlueprint?.(cwd, leaf).catch(() => undefined);
          const reBody = (reText && reText.trim() ? reText : repair.text) ?? '';
          const reManifest = parseSizeManifest(reText, repair.text);
          // Rebind manifest/blueprintBody to the revised blueprint for downstream use
          if (reText && reText.trim()) manifestText = reText;
          if (reManifest) manifest = reManifest;
          blueprintBody = reBody;
          // Re-persist the repaired blueprint (best-effort, same try/catch)
          if (reText && reManifest) {
            try {
              await deps.persistBlueprint?.({
                project,
                leaf,
                attempt: state.attempt,
                manifest: reManifest,
                blueprintMd: reText,
              });
            } catch {
              /* persistence is durable-telemetry — never break the run */
            }
          }
          // Re-validate the repaired criteria
          const redeclaredForCriteria = reManifest
            ? [...new Set([...reManifest.filesToCreate, ...reManifest.filesToEdit, ...reManifest.tasks.flatMap(t => t.files)])]
            : [];
          const redeclaredTestOnly = redeclaredForCriteria.length > 0 && redeclaredForCriteria.every(isTestFilePath);
          await prewarmBaseCitations(reBody);
          citability = validateCriteriaCitability(reBody, redeclaredForCriteria, { testOnly: redeclaredTestOnly, citationExistsAtBase });
          try {
            await deps.recordGateEval?.(project, {
              gate: 'citability',
              leafId: leaf.id,
              inputText: reBody,
              changeSet: redeclaredForCriteria,
              verdict: citability.status,
              reasons: citability.reasons.join('; '),
            });
          } catch { /* replay corpus is telemetry — never break the run */ }
        }
        const bpShadow = deps.gateShadowMode?.(project) ?? false;
        if (citability.status === 'uncitable' && !bpShadow) {
          try { await deps.bumpRetry?.(project, leaf.id); } catch { /* telemetry — never break the park */ }
          // A guard-REJECTED blueprint is not a reusable plan. Drop the leaf_blueprint
          // cache row so a later claim's planResume decides FRESH instead of reattaching
          // the rejected plan (which would drive its rejected criteria into review and
          // park again — defeating a conductor's reset+re-spec). The ledger node output
          // remains as durable telemetry; only the reuse cache is cleared.
          try { clearLeafBlueprint(leaf.id); } catch { /* cache clear is best-effort */ }
          return parkBlocked(`blueprint-uncitable-criterion: ${citability.reasons.join('; ')}`);
        }
      }
    }

    // --- AUTO-SPLIT (worker-decomposition) ---
    // SR-3: propose → bounded wait → act. Children are only created if an explicit
    // 'split' answer arrives; otherwise the leaf runs LINEAR with raised budget.
    // SR-6: the BLUEPRINT decides. A file count has no model of coupling. A blueprint-emitted
    // decision directs the split (if any) and its dependency edges. A malformed decision falls
    // through to the FLOOR (fail-safe). No decision emitted → legacy file-count gate (back-compat).

    const proposeThenAct = async (
      items: LeafSplitItem[],
      reason: string,
    ): Promise<'split' | 'linear'> => {
      if (!deps.proposeSplit || !deps.awaitSplitDecision) return 'linear';
      const proposal = deps.proposeSplit({
        project, session: sessionKey, leaf, itemCount: items.length, reason,
      });
      const answer = await deps.awaitSplitDecision({
        escalationId: proposal.escalationId, createdAt: proposal.createdAt,
      });
      if (answer === 'split') {
        await deps.splitInto!(leaf, items);
        try {
          deps.resolveProposal?.(proposal.escalationId, 'resolved', 'human');
        } catch { /* best-effort */ }
        return 'split';
      }
      // 'linear' | 'timeout' — the SAFE DEFAULT
      try {
        deps.resolveProposal?.(proposal.escalationId, 'resolved', answer === 'timeout' ? 'ai' : 'human');
      } catch { /* best-effort */ }
      // MAX_BUDGET_RAISES: a declined split raises the ceiling, but only up to the cap — past
      // it, the leaf runs at whatever budget it already has and the normal budget-exhaustion
      // path (checkBudget) takes over, rather than the leaf raising its own runaway ceiling
      // without bound across repeated declines.
      if (shouldRaiseBudget(budgetState.raises)) {
        budgetState.value = Math.max(budgetState.value, raisedNodeBudget(deps.nodeBudget ?? NODE_BUDGET));
        budgetState.raises += 1;
      }
      return 'linear';
    };

    if (deps.splitInto && manifest) {
      const decision = manifest.splitDecision;

      if (manifest.splitDecisionMalformed) {
        // A malformed decision must NEVER read as "split into N". Take the floor.
        // (fall through, no split)
      } else if (decision) {
        if (decision.split) {
          if (await proposeThenAct(decision.items, decision.reason) === 'split') {
            return finishWith({ outcome: 'split', attempts: state.attempt, nodesSpent: state.nodesSpent });
          }
          // else: fall through to the FLOOR with a raised budget
        }
        // decision.split === false ⇒ a COUPLED change. Runs WHOLE, at any file count.
        // decision.reason states the cross-file invariant. Fall through to the floor.
      } else if (!manifest.nonEnumerableFanout) {
        // LEGACY fallback: no decision emitted ⇒ the old file-count gate (back-compat).
        const splitFiles = [...new Set([
          ...manifest.filesToCreate, ...manifest.filesToEdit, ...manifest.tasks.flatMap((t) => t.files),
        ])];
        if (splitFiles.length > SPLIT_CEILING) {
          const items = splitFiles.map((f) => ({ id: f, files: [f], dependsOn: [] }));
          if (await proposeThenAct(items, `${splitFiles.length} enumerated files exceeds the size gate`) === 'split') {
            return finishWith({ outcome: 'split', attempts: state.attempt, nodesSpent: state.nodesSpent });
          }
        }
      }
    }

    // WORKTREE WRITE-LEAK MITIGATION: snapshot the MAIN checkout's dirty set BEFORE any
    // writing node, so the pre-review sweep can detect+relocate files the CLI leaked to
    // the main repo root (gitlink/common-dir root detection) instead of this worktree.
    let rootSnap: RootSnapshot | null = null;
    try { rootSnap = snapshotMainCheckout(cwd); } catch { /* best-effort */ }
    if (rootSnap) lastRootSnap = { cwd, snap: rootSnap };

    // G12: Snapshot untracked files BEFORE the first writing node so we can later
    // distinguish files the leaf created (new) from pre-existing junk.
    try { untrackedAtStart = listUntrackedPaths(cwd); } catch { /* best-effort */ }

    // G12: Derive the declared scope from the manifest + the split-child description.
    const declaredFiles = [...new Set([
      ...(manifest ? [...manifest.filesToCreate, ...manifest.filesToEdit, ...manifest.tasks.flatMap(t => t.files)] : []),
      ...parseDeclaredScope(leaf.description),
    ])];

    // Friction 552f95c2: pre-existing MAIN-checkout dirt inside this leaf's declared scope is
    // prior-attempt leak debris (a killed run never swept) — quarantine + restore the root now,
    // or every later snapshot grandfathers it forever. Loud: warn + friction, never silent.
    if (rootSnap && rootSnap.root) {
      try {
        const quarantineDir = join(rootSnap.root, '.collab', 'leak-quarantine', `${leaf.id.slice(0, 8)}-a${state.attempt}`);
        const reclaimed = reclaimPreDirtyScopeOverlap(cwd, rootSnap, declaredFiles, quarantineDir);
        if (reclaimed.length) {
          console.warn(`[leaf-executor] main-checkout leak DEBRIS reclaimed (${reclaimed.join(', ')}) — dirty content quarantined at ${quarantineDir}, root restored to HEAD`);
          recordFriction(project, {
            layer: 'orchestration',
            retryReason: 'main-checkout-leak-debris-reclaimed',
            todoId: leaf.id,
            detail: `Pre-existing dirty tracked files in the MAIN checkout overlapped this leaf's declared scope (prior-attempt write-leak, never swept because that run was killed/dropped). Reclaimed: ${reclaimed.join(', ')}. Dirty content quarantined at ${quarantineDir}; main checkout restored to HEAD. If a HUMAN was editing these files, recover from the quarantine.`,
          }).catch(() => { /* friction is telemetry — never break the run */ });
        }
      } catch { /* never break the run on the mitigation */ }
    }

    // WAVES RETIRED (2026-07-08): every claimed leaf runs LINEAR (FLOOR). A leaf too big
    // for one linear run (> SPLIT_CEILING = FILE_THRESHOLD enumerated files) was already
    // auto-split PRE-FLIGHT above, so anything reaching here is within the linear band —
    // the proven-cheap+reliable path (measured ~5 nodes / ~90% pass vs the old fan-out's
    // ~27 nodes / ~63%). The rare non-enumerable-big or many-task leaf that dodged the
    // split also runs linear (fail-safe). (The old runWaves/buildWavePrompt/wavesBudget/
    // shouldUseFloor machinery was deleted in the WAVES dead-code sweep.)
    // LeafTier 'test-pinned' CODE-level immutability (41779cf0): the leaf's declared
    // test file(s) are the pinned executable spec — hash them BEFORE implement runs so
    // the merge-time check below can catch a weakened/edited pin structurally, never by
    // relying on a prompt-level ban (a ban in a leaf spec is decoration).
    const testPinnedTier = leaf.tier === 'test-pinned';
    const testPinBaseline = testPinnedTier
      ? hashPinnedFiles(cwd, declaredFiles.filter(isTestPinnedPath))
      : {};

    state.pathTaken = 'floor';
    // IMPLEMENT (byte-identical to the prior FLOOR path):
    let impl = await runNode('implement', buildSpec('implement', cwd, blueprintBody));
    if (impl.startFailure) {
      // Reactive escalation: a start-failure (timeout + zero tokens) on the pinned
      // implement model is usually the refactor overrunning the per-node ceiling, not a
      // real start failure. Retry ONCE in-place on the escalation model (a higher tier);
      // otherwise the daemon re-claims and re-runs the SAME model → identical failure → churn.
      const baseImpl = nodeModel('implement');
      const bpModel = resolveEscalationModel();
      if (!escalatedKinds.has('implement') && baseImpl !== bpModel && checkBudget()) {
        console.warn(`[leaf-executor] implement start-failure on ${baseImpl} → escalating in-place retry to ${bpModel}`);
        escalatedKinds.add('implement'); // nodeModel('implement') now returns bpModel
        impl = await runNode('implement', buildSpec('implement', cwd, blueprintBody)); // rebuilt spec uses the escalated model
      }
      if (impl.startFailure) return parkNodeStartFailure('implement', impl);
    }
    // Surface a shell escape out of the worktree HERE (right after implement), not as a
    // mystery empty diff minutes later.
    checkWorkingRootEscape(cwd);
    if (impl.rateLimited) return pausedResult('implement', impl);
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');

    // PRE-REVIEW EMPTY-DIFF SHORT-CIRCUIT: if the implement node produced a zero-file
    // diff against the epic base, skip the review node entirely and settle according to
    // whether files were declared in scope. (Branch 1) Declared scope is empty and diff
    // is empty: base already satisfies, settle as accepted without review. (Branch 2)
    // Files were declared but implement produced no changes: escalate as a distinct
    // incident (not a reviewer rejection — no review ran) and park.
    try { stageUntrackedIntentToAdd(cwd); } catch { /* best-effort */ }
    let preReviewChangeSet = (await deps.changeSet?.(sessionKey)) ?? null;
    if (preReviewChangeSet !== null && preReviewChangeSet.length === 0) {
      // SALVAGE (friction 6150b497): the change-set is derived from COMMITS vs the epic
      // base — an implement that did real work but never ran `git commit` reads as an
      // empty diff and gets parked as "produced nothing" (observed: leaf f6dbf929 left
      // +58 lines across 2 files plus a new untracked module, all uncommitted). Before
      // classifying the diff empty, check the WORKING TREE: if dirty/untracked work
      // exists (collab bookkeeping excluded), commit it ALL with the standard worker
      // commit shape, recompute the change-set, and proceed to review exactly as if the
      // implement had committed — never re-running implement, never parking empty-diff,
      // never burning an extra attempt. A genuinely CLEAN tree falls through to the
      // existing two-arm classification unchanged.
      let salvageable: string[] = [];
      try {
        const raw = deps.worktreeDirty
          ? deps.worktreeDirty(cwd)
          : [...new Set([...trackedDirtyPaths(cwd), ...listUntrackedPaths(cwd)])];
        salvageable = raw.filter((p) => p !== '.collab' && !p.startsWith('.collab/'));
      } catch { /* best-effort: unreadable tree reads as clean */ }
      if (salvageable.length > 0) {
        const salvageMessage = `feat: ${leaf.title ?? leaf.id}\n\nCollab-Todo: ${leaf.id}`;
        const committed = deps.salvageCommit
          ? await deps.salvageCommit(cwd, salvageMessage, salvageable).catch(() => null)
          : await salvageCommitDefault(cwd, salvageMessage, salvageable);
        if (committed) {
          console.warn(`[leaf-executor] work-present-uncommitted: salvaged ${salvageable.length} dirty/untracked file(s) into commit ${committed.sha?.slice(0, 8) ?? '?'} — proceeding to review`);
          try {
            deps.recordNode({
              project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
              nodeKind: 'work-present-uncommitted', nodesSpent: 0, verdict: 'pass',
              outcomeDetail: JSON.stringify({ reason: 'work-present-uncommitted', fileCount: salvageable.length, sha: committed.sha ?? null }),
              outputText: `work-present-uncommitted: implement did real work (${salvageable.length} dirty/untracked file(s)) but never ran git commit — salvaged into a worker-shaped commit on the leaf branch and proceeding to review (no implement re-run, no empty-diff park).`,
            });
          } catch { /* telemetry — never break the run */ }
          // Recompute from commits; fall back to the salvaged paths so a stale/unwired
          // recompute can never re-classify freshly committed work as an empty diff.
          const recomputed = (await deps.changeSet?.(sessionKey)) ?? null;
          preReviewChangeSet = recomputed && recomputed.length > 0 ? recomputed : salvageable;
        }
      }
    }
    if (preReviewChangeSet !== null && preReviewChangeSet.length === 0) {
      if (declaredFiles.length === 0) {
        // Branch 1: base-already-satisfies (no declared files, zero-file diff).
        try {
          deps.recordNode({
            project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
            nodeKind: 'base-already-satisfies', nodesSpent: 0, verdict: 'pass',
            outcomeDetail: JSON.stringify({ reason: 'base-already-satisfies' }),
            outputText: 'base-already-satisfies: implement produced a zero-file diff vs the epic base and no files were declared in scope — settling without spending a review node.',
          });
        } catch { /* telemetry — never break the run */ }
        const gate = await deps.complete(project, leaf.id, 'accepted');
        const effective = gate.effective ?? 'accepted';
        const outcome: LeafRunResult['outcome'] = effective;
        const reason = effective === 'pending' ? 'gate-pending'
          : effective === 'rejected' ? 'gate-rejected'
          : 'base-already-satisfies';
        recordOutcome(outcome, null, { reason, pendingReason: gate.pendingReason, gateReasons: gate.gateReasons });
        return finishWith({ outcome, attempts: state.attempt, nodesSpent: state.nodesSpent, reason });
      } else {
        // Branch 2: spec-demands-changes (files declared but implement produced nothing).
        // OWN PRIOR WORK ALREADY PRESENT (real incident 2026-07-24): the comment below
        // already named this cause ("likely a sibling leaf already landed the same change")
        // but nothing checked for it — so a leaf whose OWN work was committed to the epic
        // branch on an early attempt was re-dispatched 11 times (master kept moving ⇒
        // reattach-blueprint ⇒ implement correctly concluded "already committed, no edits
        // needed" ⇒ zero-file diff ⇒ park blocked), dep-blocking every dependent leaf until a
        // human override-accepted it. Before escalating, ask git whether a commit carrying
        // THIS leaf's own `Collab-Todo` trailer is already on the epic branch's own history.
        // A positive, unambiguous hit settles the leaf ACCEPTED through the normal gate (no
        // review node, no escalation — there is nothing for a human to decide). Anything else
        // (absent, git error, unwired seam) FAILS CLOSED into the legacy escalate+park below.
        let ownCommit: { sha: string } | null = null;
        try {
          ownCommit = (await deps.ownWorkCommitOnEpicBranch?.({
            leafId: leaf.id,
            epicBranch: deps.epicBranch,
            baseBranch: deps.baseBranch ?? 'master',
          })) ?? null;
        } catch {
          ownCommit = null; // FAIL CLOSED — an unreadable probe is never a positive
        }
        if (ownCommit?.sha) {
          console.warn(`[leaf-executor] own-work-already-committed: zero-file diff explained by this leaf's own commit ${ownCommit.sha.slice(0, 8)} on ${deps.epicBranch} — settling accepted instead of parking blocked`);
          try {
            deps.recordNode({
              project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
              nodeKind: 'own-work-already-committed', nodesSpent: 0, verdict: 'pass',
              outcomeDetail: JSON.stringify({ reason: 'own-work-already-committed', sha: ownCommit.sha, declaredFiles }),
              outputText:
                `own-work-already-committed: implement produced a zero-file diff vs the epic base even though the blueprint declared file(s) to change (${declaredFiles.join(', ')}) — because THIS leaf's own work is ALREADY on ${deps.epicBranch} from a prior attempt (commit ${ownCommit.sha}, carrying trailer "Collab-Todo: ${leaf.id}"). ` +
                `Settling accepted through the normal completion gate without spending a review node, instead of parking blocked on empty-diff-spec-demands-changes (which would dep-block every dependent leaf for a re-dispatch that can never produce a diff).`,
            });
          } catch { /* telemetry — never break the run */ }
          const gate = await deps.complete(project, leaf.id, 'accepted');
          const effective = gate.effective ?? 'accepted';
          const outcome: LeafRunResult['outcome'] = effective;
          const reason = effective === 'pending' ? 'gate-pending'
            : effective === 'rejected' ? 'gate-rejected'
            : 'own-work-already-committed';
          recordOutcome(outcome, null, { reason, pendingReason: gate.pendingReason, gateReasons: gate.gateReasons });
          return finishWith({ outcome, attempts: state.attempt, nodesSpent: state.nodesSpent, reason });
        }
        // THREE causes, most-common FIRST. (1) is the 2026-07-24 build123d class: the node
        // `cd`s out of the lane worktree to the MAIN checkout named by the leaf's tracking
        // root / blueprint prior art, edits and tests THERE (honestly green), and the
        // executor — which diffs the WORKTREE — sees nothing. Misfiled as (2)/(3) three times
        // in one day, so it is named explicitly with the evidence to check.
        const escapeNote = workingRootEscape
          ? `DETECTED ON THIS RUN: ${(workingRootEscape as { message: string }).message} `
          : '';
        deps.escalate({
          project, session: sessionKey, kind: 'empty-diff-declared-changes', todoId: leaf.id,
          questionText:
            `Leaf "${leaf.title ?? leaf.id}" implemented a ZERO-FILE diff against the epic base, but its blueprint declared file(s) to change (${declaredFiles.join(', ')}). ` +
            `This blames the empty IMPLEMENT diff — NOT a reviewer rejection (no review node ran). Three causes, most common first: ` +
            `(1) the implement node LEFT ITS WORKTREE — it edited and tested in the MAIN checkout (${deps.mainCheckoutRoot ?? 'the tracking root'}) after a \`cd\` out of ${cwd}, so its work is real and green but invisible to the worktree diff. ` +
            `${escapeNote}CHECK: read the recorded commands' \`cwd\` on this leaf's implement node rows (worker ledger \`commands\` column) — any cwd outside ${cwd} is this cause. ` +
            `FIX: recover/inspect the main checkout for uncommitted work (\`git -C ${deps.mainCheckoutRoot ?? '<main-checkout>'} status\`), then re-run implement; the executor's write-leak sweep relocates leaked FILE writes but cannot relocate a test run. ` +
            `(2) a sibling leaf already landed the same change on the epic base. (3) implement genuinely produced no edits. ` +
            `Needs a human/conductor call: accept as already-satisfied, or re-run implement.`,
        });
        return parkBlocked(
          workingRootEscape ? 'empty-diff-after-working-root-escape' : 'empty-diff-spec-demands-changes',
        );
      }
    }

    // REVIEW + P6 SURGICAL REUSE. Review the tree; on a missing-logic FAIL (a NEW
    // finding) re-run the IMPLEMENT node IN PLACE — same worktree, keeping the correct
    // work — with the findings, up to REVISE_REUSE_CAP times, then re-review. A REPEATED
    // finding ⇒ stuck ⇒ stop reusing and fall through to a fresh attempt. Every node
    // still increments the budget; rate-limit pauses short-circuit as elsewhere.
    // (Evidence: live L2 attempt-1 was correct but missing one required test — fresh-
    // every-attempt discarded that near-complete work; reuse adds the gap in place.)
    let reviewVerdict: 'pass' | 'fail';
    let reuses = 0;
    let prevFindings = '';
    // The FINAL findings this attempt produced (captured each review cycle) — read by the
    // cross-attempt SAME-WALL check after the revise loop, where `findings` is out of scope.
    let attemptFinalFindings = '';
    for (;;) {
      // Relocate any files the implement/wimplement/fix nodes leaked to the MAIN checkout
      // back into THIS worktree before the review node runs `git status` here — otherwise a
      // correct implementation reads as "file absent" → false FAIL → thrash. Best-effort.
      if (rootSnap) {
        try {
          const swept = sweepLeakedWrites(cwd, rootSnap);
          if (swept.length) console.warn(`[leaf-executor] worktree write-leak: relocated ${swept.length} leaked file(s) from the main checkout into the worktree (${swept.slice(0, 5).join(', ')}${swept.length > 5 ? ', …' : ''})`);
        } catch { /* never break the run on the mitigation */ }
      }
      // NEW-FILE VISIBILITY: a file the implement/fix node CREATED is untracked, and `git diff`
      // never shows untracked files — the review node then truthfully reports it "absent" and the
      // leaf thrashes implement→review to node-budget exhaustion (f0f0bd49). Record the path in
      // the index (content NOT staged) so every git view the reviewer uses sees it. Explicit,
      // .gitignore-respecting path list — never `git add -A`; worktrees carry 20+ untracked junk
      // paths (db snapshots, deploy logs). Best-effort.
      try {
        const staged = stageUntrackedIntentToAdd(cwd);
        if (staged.length) console.warn(`[leaf-executor] intent-to-add: made ${staged.length} new file(s) visible to review (${staged.slice(0, 5).join(', ')}${staged.length > 5 ? ', …' : ''})`);
      } catch { /* never break the run on the mitigation */ }
      // --- MECHANICAL GATE (G2) ---------------------------------------------------
      // The executor runs the PROJECT's own gate at this leaf's HEAD. The base was
      // proven green once per epic, so any failure here is BY CONSTRUCTION this leaf's
      // own — no baseline diff, no per-file test selection heuristics.
      let mech: LeafGateResult;
      const gateRun = await deps.runGate?.(cwd);
      if (gateRun) {
        mech = gateRun;
      } else {
        // UNWIRED SEAM — not a pass anybody computed. Say so, and leave a ledger row, exactly
        // as the `absent` DECLARATION path does (see makeLeafExecutorDeps.runGate). Silence
        // here restores LLM-ratifies-itself, which is the failure G4 exists to make loud.
        warnGateUnwired(project, epicId);
        try {
          deps.recordNode({
            project,
            todoId: leaf.id,
            session: sessionKey,
            epicId,
            leafId: leaf.id,
            nodeKind: 'gate-abstain',
            nodesSpent: 0,
            verdict: 'pass',
            outcomeDetail: 'gate-unwired',
            outputText: 'deps.runGate is not wired — no mechanical gate ran for this leaf',
          });
        } catch { /* best-effort telemetry */ }
        mech = { status: 'pass', output: '', reasons: ['gate: runGate dep unwired'], declared: false };
      }
      gateDeclared = mech.declared;

      // A GATE THAT COULD NOT RUN IS NOT A FAILING GATE. An INCIDENT, not a finding:
      // park blocked, escalate, spawn NO fix node (80bacbc4, one layer down).
      if (mech.status === 'error') {
        try { await deps.bumpRetry?.(project, leaf.id); } catch { /* telemetry — never break the park */ }
        return parkBlocked(formatGateErrorReason(mech));
      }

      // A mechanically-red tree NEVER spends a review node. The LLM's opinion on broken
      // code is worth exactly nothing, and it costs an opus call to obtain.
      let llm: LeafReviewVerdict | null = null;
      let findings: string;
      // Set when a PROSE gate RETRIES (not parks): forces findings=synth + llm='fail' so
      // the revise loop re-runs implement, and makes the unconditional
      // `findings = (review.text).trim()` below MUTUALLY EXCLUSIVE with the retry path —
      // otherwise it clobbers the synthesized findings (the defect that livelocked prior attempts).
      let proseRetryFindings: string | null = null;
      // crit 1 (falsifiability): set when a GENUINE review FAIL on a GREEN mechanical gate
      // cites NO falsifiable defect (grounding vacuous/abstain = "can't verify" / "nothing to
      // review"). Such a veto is an ABSTAIN — it must NOT gate a green change (the mechanical
      // gate carries the accept). A FAIL citing a concrete defect leaves this false and gates.
      let reviewAbstained = false;
      // crit 3 (advisory-when-covered): set when a FALSIFIABLE FAIL contests a GREEN mechanical
      // change whose edit is COVERED (the declared tests FLIP base→branch). The covering tests
      // REFUTE the finding — an independent mechanical proof the change works — so the LLM veto
      // is ADVISORY (surfaced, not gating). Uncovered/unknown leaves this false and gates.
      let reviewAdvisory = false;
      if (mech.status === 'fail') {
        findings = gateFindingsText(mech);
      } else {
        // crit 6 OPTIMISTIC LANDING (part 1): for the small / test-pinned tiers the GREEN
        // mechanical gate IS the landing gate — merge to the epic branch NOW, before the
        // review node, then review POST-merge. Strictly downstream of a proven-green mech
        // (the error/fail arms above already returned/branched, so this runs only on
        // mech.status==='pass'). test-pinned tier: the sha256 immutability of the pinned
        // spec is part of "green" — a tampered pin must NEVER land, so check it FIRST and
        // park (pre-merge, no optimistic land) on any violation. Full tier: skipped entirely
        // (merge stays after review, unchanged). Done once per leaf (!optimisticallyLanded)
        // so a revise pass never double-merges.
        if ((smallTier || testPinnedTier) && !optimisticallyLanded) {
          if (testPinnedTier) {
            const violations = testPinViolations(
              testPinBaseline,
              hashPinnedFiles(cwd, Object.keys(testPinBaseline)),
            );
            if (violations.length) {
              return parkBlocked(
                `test-pinned-immutability: pinned test file(s) modified: ${violations.join(', ')}`,
              );
            }
          }
          try {
            const mergeRes = (await deps.mergeToEpic(
              sessionKey,
              epicId,
              `feat: ${leaf.title ?? leaf.id}`,
              leaf.id,
              { declaredFiles, untrackedAtStart },
            )) as { merged?: boolean; conflict?: boolean; integrated?: boolean; mergeSha?: string } | undefined;
            if (mergeRes && mergeRes.merged === false) {
              // Conflict — the epic branch is untouched. Do NOT set optimistically
              // landed; park exactly as the post-review merge-failure path does.
              return parkBlocked(
                `merge-to-epic-failed (optimistic): conflict=${mergeRes.conflict === true}`,
              );
            }
            // NO-OP / PHANTOM merge (integrated===false): a clean or stale worktree carried
            // NOTHING to commit, so the merge was "already up to date" — its mergeSha is the
            // epic TIP (an UNRELATED commit / a prior leaf's merge), NOT this leaf's. Setting
            // optimisticallyLanded here would make a later review FAIL revert the WRONG commit
            // (in a multi-leaf small-tier epic: revert a PRIOR leaf's real landed work). So
            // this leaf landed nothing — leave optimisticallyLanded=false and fall through to
            // review, which FAILs "nothing to review" and parks WITHOUT a revert (correct for
            // an empty/stale leaf). Surfaced by a live small-tier run on an already-landed leaf.
            if (mergeRes && mergeRes.integrated === false) {
              try {
                deps.recordNode({
                  project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
                  nodeKind: 'optimistic-land-skipped', nodesSpent: 0, verdict: 'fail',
                  outcomeDetail: JSON.stringify({ reason: 'no-op-merge-nothing-integrated', tier: leaf.tier }),
                  outputText: 'optimistic-land skipped: merge integrated nothing (clean/stale worktree) — review will park this empty leaf, no revert',
                });
              } catch { /* telemetry — never break the run */ }
            } else {
              optimisticMergeSha = mergeRes?.mergeSha;
              optimisticallyLanded = true;
              deps.markMerged?.(leaf.id);
              try {
                deps.recordNode({
                  project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
                  nodeKind: 'optimistic-land', nodesSpent: 0, verdict: 'pass',
                  outcomeDetail: JSON.stringify({ mergeSha: optimisticMergeSha, tier: leaf.tier }),
                  outputText: `optimistic-land: merged ${optimisticMergeSha ?? '(sha?)'} after GREEN mechanical gate, review runs post-merge`,
                });
              } catch { /* telemetry — never break the run */ }
            }
          } catch (e) {
            if (e instanceof ScopeIncidentError) {
              deps.escalate({
                project, session: sessionKey, kind: 'blocker', todoId: leaf.id,
                questionText:
                  `Leaf "${leaf.title ?? leaf.id}" produced NO change inside its declared scope (${declaredFiles.join(', ') || 'none'}). ` +
                  `Dirty-but-out-of-scope: ${e.outOfScope.slice(0, 20).join(', ')}. Nothing was committed.`,
              });
              return parkBlocked('scope-incident');
            }
            return parkBlocked(
              `merge-to-epic-failed (optimistic): ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        // GATE–REVIEW SERIALIZATION: review must run only after gate passes (mech.status==='pass').
        // Three dependencies enforce this: (1) gate ERROR short-circuits at :3812, (2) gate FAIL
        // branches at :3836 with review spawned only in the else-arm (:3920), (3) optimistic merge
        // at :3861 precedes review so post-land revert (:4159) is meaningful. Falsifiability
        // demotions (:4024, :4056, :4148) are gate-conditioned; review PROMPT is gate-blind (:1491).
        // See docs/gate-review-serialization.md for the full analysis.

        // Route review depth based on diff risk (hot-path changes, large diffs, etc.).
        const riskBaseRef = deps.epicBaseSha ?? epicBranch;
        const risk = await (deps.collectDiffRisk ?? collectDiffRisk)(cwd, riskBaseRef);
        const route = routeReviewDepth(risk, { lightPathEnabled: resolveLightPathEnabled(project) });

        try {
          deps.recordNode({
            project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
            nodeKind: 'review-route', nodesSpent: 0,
            outcomeDetail: JSON.stringify({ depth: route.depth, files: risk.files.length, addedLines: risk.addedLines, deletedLines: risk.deletedLines, tier: leaf.tier }),
            outputText: `review-route: ${route.depth} — ${route.reasons.join('; ')}`,
          });
        } catch { /* telemetry — never break the run */ }

        const review = await runNode('review', buildSpec('review', cwd, blueprintBody, undefined, route.depth));
        if (review.startFailure) return parkNodeStartFailure('review', review);
        if (review.rateLimited) return pausedResult('review', review);
        llm = parseVerdict(review.text);
        // INFRA, not a finding (80bacbc4): the reviewer emitted nothing parseable. Feeding ''
        // back to implement is a livelock (empty findings also defeat the isRepeat stuck-
        // detector below, so it runs to node-budget exhaustion). Park, and RECORD it —
        // retryCount stayed 0 before, so the graph showed no incident at all.
        if (llm === 'error') {
          const d = await proseOffense('review-unparseable', 'review-vacuous');
          if (d.park) return parkBlocked('review-vacuous');
          proseRetryFindings = d.findings; // first offense → retry with synthesized findings
        }
        // --- G3 GROUNDING GATE -------------------------------------------------
        // A PASS is the ONLY path from an LLM string to an accept, so it is the only one
        // that must prove it looked. Structure + citations are MECHANICAL; the semantics
        // of each criterion remain the LLM's. A FAIL is deliberately exempt: it never
        // accepts, and forcing structure on it would turn a real finding into a park.
        if (llm === 'pass') {
          const cs = (await deps.changeSet?.(sessionKey)) ?? null;
          const grounding = validateReviewGrounding(review.text ?? '', cs, {
            citationExists: makeCitationExists(cwd),
          });
          try {
            await deps.recordGateEval?.(project, {
              gate: 'g3',
              leafId: leaf.id,
              inputText: review.text ?? '',
              changeSet: cs ?? [],
              verdict: grounding.status,
              reasons: grounding.reasons.join('; '),
            });
          } catch { /* replay corpus is telemetry — never break the run */ }
          const shadow = deps.gateShadowMode?.(project) ?? false;
          if (grounding.retainedMode && grounding.status === 'ok') {
            groundingNote = grounding.reasons[0]; // 'retained mode …' — auditable, non-fatal
          }
          if (grounding.status === 'vacuous') {
            // FLOOR-PATH FIX: a COMMAND-RESULT criterion (tsc/test/build/lint/grep) cannot be
            // cited to a diff line — verifying it is the command-evidence gate's job below, not
            // grounding's. When the ONLY uncited criteria are structural command-results, defer to
            // that gate rather than discard a correct leaf (the class that stranded floor-path
            // leaves B1/A*). Absence/non-goal criteria are NOT deferred — the reviewer marks those
            // [N/A]; auto-exempting them would false-pass a real negative check ("no regression").
            const deferToEvidence = uncitedCriteriaAreAllCommandResults(grounding.criteria, cs ?? []);
            if (!deferToEvidence && !shadow) {
              const d = await proseOffense('review-vacuous', `review-vacuous: ${grounding.reasons.join('; ')}`);
              if (d.park) return parkBlocked(`review-vacuous: ${grounding.reasons.join('; ')}`);
              proseRetryFindings = d.findings; // first offense → retry
            }
          }
          // C2: evidence gate — the claim must be a fact the executor holds. Skip when a
          // prior prose gate (G3-vacuous) already chose to RETRY this cycle — one review
          // cycle counts as at most ONE prose offense.
          if (proseRetryFindings === null) {
            const evidence = evaluateCommandEvidence({
              commands: recordedCommands,
              claims: parseVerificationClaims(grounding.criteria, review.text ?? ''),
              worktreeRoot: cwd,
            });
            if (evidence.reject) {
              const d = await proseOffense('command-evidence', `command-evidence: ${evidence.reasons.join('; ')}`);
              if (d.park) return parkBlocked(`command-evidence: ${evidence.reasons.join('; ')}`);
              proseRetryFindings = d.findings; // first offense → retry
            } else {
              unbackedNote = evidence.unbackedClaims.length
                ? `unbacked-claim (non-fatal): ${evidence.reasons.join('; ')}`
                : undefined;
            }
          }
        } else if (llm === 'fail' && proseRetryFindings === null) {
          // --- FALSIFIABILITY GATE (crit 1) --------------------------------------
          // The LLM cannot VETO a GREEN mechanical gate on a NON-falsifiable finding.
          // We are in the mech.status==='pass' arm (a red gate never reaches here — the
          // hard floor holds), and this is a GENUINE parseVerdict FAIL (not a prose-gate
          // retry). Classify it with the SAME grounding predicate a PASS must satisfy: a
          // FAIL that cites a concrete, resolvable defect (a diff line) is grounding 'ok'
          // and STILL gates; a FAIL that cites nothing checkable ('vacuous'/'abstain' =
          // "can't verify" / "nothing to review" — the exact shape of the observed
          // executor-core over-rejections) is an ABSTAIN and must NOT gate. Doubt is not
          // a defect; the green mechanical gate is the independent correctness signal.
          const cs = (await deps.changeSet?.(sessionKey)) ?? null;
          const grounding = validateReviewGrounding(review.text ?? '', cs, {
            citationExists: makeCitationExists(cwd),
          });
          try {
            await deps.recordGateEval?.(project, {
              gate: 'g3',
              leafId: leaf.id,
              inputText: review.text ?? '',
              changeSet: cs ?? [],
              verdict: grounding.status,
              reasons: `fail-falsifiability: ${grounding.reasons.join('; ')}`,
            });
          } catch { /* replay corpus is telemetry — never break the run */ }
          const shadow = deps.gateShadowMode?.(project) ?? false;
          // ABSTAIN only on genuine NON-falsifiable DOUBT ("can't confirm" / "nothing to
          // review") over a REAL change-set (≥1 file). A bare FAULT claim ("VERDICT: FAIL —
          // missing null check") is NOT doubt → still gates (the revise loop stays intact for
          // real findings). An EMPTY change-set (no-op / stale leaf) is NOT abstained — that is
          // the crit-6 no-op leaf's job to park; abstaining an empty leaf would false-accept it.
          if ((cs?.length ?? 0) > 0 && isNonFalsifiableReviewDoubt(review.text ?? '') && !shadow) {
            // Non-falsifiable veto on a green change → ABSTAIN. Do NOT gate; record it so the
            // graph shows the abstain (and the reviewer's prose is surfaced advisorily below).
            reviewAbstained = true;
            try {
              deps.recordNode({
                project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
                nodeKind: 'review-abstain', nodesSpent: 0, verdict: 'pass',
                outcomeDetail: JSON.stringify({ reason: 'non-falsifiable-fail-on-green-mech', grounding: grounding.status }),
                outputText: `review-abstain: LLM FAIL on a GREEN mechanical gate cited no falsifiable defect (${grounding.status}: ${grounding.reasons.join('; ')}) — abstain, do not gate`,
              });
            } catch { /* telemetry — never break the run */ }
          } else if ((cs?.length ?? 0) > 0) {
            // --- COVERAGE-WEIGHTED ADVISORY (crit 2 + 3) ---------------------------
            // A FALSIFIABLE fault claim contests a GREEN mechanical change over a real
            // change-set. LAZILY (only here — the contested minority; a base test run is ~2×)
            // ask whether the leaf's DECLARED tests FLIP base→branch: do they FAIL against the
            // base impl (and pass at HEAD, already proven by the green gate)? If so, the
            // covering tests REFUTE the finding — an independent mechanical proof the change
            // works — so the LLM veto is ADVISORY. DEFENSIVE: only a POSITIVE `true` accepts;
            // false / null / unknown still GATES (never wrongly accept on an unproven change).
            const declaredTests = declaredFiles.filter(isTestFilePath);
            const covered = declaredTests.length > 0
              ? (await deps.testsFlipBaseToBranch?.({ cwd, testFiles: declaredTests, baseSha: deps.epicBaseSha }) ?? null)
              : null;
            try {
              deps.recordNode({
                project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
                nodeKind: 'coverage', nodesSpent: 0, verdict: covered === true ? 'pass' : 'fail',
                outcomeDetail: JSON.stringify({ covered, declaredTests }),
                outputText: `coverage: declared tests [${declaredTests.join(', ') || 'none'}] flip base→branch = ${covered === null ? 'unknown' : covered}`,
              });
            } catch { /* telemetry — never break the run */ }
            if (covered === true && !shadow) {
              // crit 3: covered → the covering tests refute the finding → ADVISORY, do not gate.
              reviewAdvisory = true;
              try {
                deps.recordNode({
                  project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
                  nodeKind: 'advisory-override', nodesSpent: 0, verdict: 'pass',
                  outcomeDetail: JSON.stringify({ reason: 'covered-falsifiable-fail-refuted-by-tests', declaredTests }),
                  outputText: `advisory-override: LLM FAIL on a GREEN, test-COVERED change is ADVISORY (declared tests flip base→branch, refuting the finding) — surfaced, not gating. Finding: ${(review.text ?? '').trim().slice(0, 300)}`,
                });
              } catch { /* telemetry — never break the run */ }
            } else if (!shadow) {
              // crit 4: NO-SILENT-PARK. covered !== true (UNCOVERED / unknown) — the LLM's the
              // only signal and it is contested. On the 2nd such cycle (the same-wall analog),
              // raise ONE bounded-wait CONTESTED-ACCEPT card instead of silently parking. accept
              // → land (via reviewAdvisory → the existing accept path); reject/timeout → keep
              // gating (today's park = the safe default). Raised at most once per leaf.
              uncoveredContestedSeen += 1;
              if (uncoveredContestedSeen >= 2 && !contestedCardRaised && deps.proposeContested && deps.awaitContestedDecision) {
                contestedCardRaised = true;
                try {
                  deps.recordNode({
                    project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
                    nodeKind: 'contested-card', nodesSpent: 0, verdict: 'fail',
                    outcomeDetail: JSON.stringify({ reason: 'green-mech-uncovered-contested-same-wall' }),
                    outputText: `contested-card: GREEN mech + UNCOVERED + same-walled review FAIL — raising a bounded-wait accept/reject decision card instead of a silent park. Finding: ${(review.text ?? '').trim().slice(0, 300)}`,
                  });
                } catch { /* telemetry — never break the run */ }
                const card = deps.proposeContested({ project, session: sessionKey, leaf, reason: (review.text ?? '').trim().slice(0, 400) || 'uncovered contested review' });
                const decision = await deps.awaitContestedDecision({ escalationId: card.escalationId, createdAt: card.createdAt });
                try { deps.resolveProposal?.(card.escalationId, 'resolved', decision === 'timeout' ? 'ai' : 'human'); } catch { /* best-effort */ }
                if (decision === 'accept') {
                  // Human/conductor ruled: land the mechanically-green change; the finding is a
                  // follow-up, not a blocker. Route through the existing advisory-accept path.
                  reviewAdvisory = true;
                  try {
                    deps.recordNode({
                      project, todoId: leaf.id, session: sessionKey, epicId, leafId: leaf.id,
                      nodeKind: 'contested-accepted', nodesSpent: 0, verdict: 'pass',
                      outcomeDetail: JSON.stringify({ reason: 'human-ruled-accept-on-uncovered-contested' }),
                      outputText: 'contested-accepted: human/conductor ruled ACCEPT on a green-mech uncovered-contested leaf — landing; finding filed as follow-up.',
                    });
                  } catch { /* telemetry — never break the run */ }
                }
                // reject | timeout → leave reviewAdvisory false → keep gating → today's park.
              }
            }
          }
        }
        if (proseRetryFindings !== null) {
          // A prose gate RETRIED this cycle: feed the synthesized findings back to implement
          // and force a FAIL compose. MUTUALLY EXCLUSIVE with the raw-review-text assignment
          // below, so the synth findings are NOT clobbered (defect A).
          findings = proseRetryFindings;
          llm = 'fail';
        } else {
          findings = (review.text ?? '').trim();
          // ADVISORY cite-check (never gates): flag a review citing an unknown/inactive
          // constraint id. Pairs Payload C's injected ACTIVE CONSTRAINTS block with a
          // warn-only enforcement half. Result is surfaced/recorded ONLY — it does not
          // touch `llm`, `reviewVerdict`, or composeVerdict.
          let activeConstraintIds: string[] = [];
          try {
            activeConstraintIds = getActiveConstraints(project, epicId).map((c) => c.id);
          } catch {
            // advisory cite-check — a constraints store read failure (unopenable/unwritable DB)
            // must never break the leaf run; degrade to "no active constraints to cross-check".
          }
          const citeCheck = checkConstraintCitations(review.text ?? '', activeConstraintIds);
          if (citeCheck.fabricated.length > 0) {
            constraintCiteNote =
              `constraint-cite (advisory): review cites unknown/inactive constraint id(s): ` +
              citeCheck.fabricated.join(', ');
            console.warn(`[leaf-executor] ${constraintCiteNote}`);
          }
        }
      }

      // final = mechanical AND llm. Never "whichever spoke last": a review's bare
      // `VERDICT: PASS` composes as composeVerdict('fail','pass') === 'fail' against a
      // red gate — there is no code path from an LLM string to an accept when the
      // gate is red (the 84048309 shape).
      // mech.status/llm are statically 'error'-typed but both 'error' arms above already
      // returned, so at runtime composeVerdict can only yield 'pass' | 'fail' here.
      attemptFinalFindings = findings;
      reviewVerdict = composeVerdict(mech.status, llm) as 'pass' | 'fail';
      // crit 1 (falsifiability): a GENUINE FAIL on a GREEN mechanical gate that cited no
      // falsifiable defect ABSTAINED above — it must NOT gate. Flip it to 'pass' so the green
      // mechanical gate carries the accept. Ordered BEFORE the optimistic-revert + pass-break
      // so an abstained small-tier leaf accepts (keeps its optimistic merge) rather than
      // reverting on a non-falsifiable veto. reviewAbstained is only ever set when
      // mech.status==='pass', so the hard mechanical floor is untouched.
      // crit 3 adds reviewAdvisory: a FALSIFIABLE FAIL on a GREEN, test-COVERED change (its
      // declared tests flip base→branch) is refuted by the covering tests → advisory, accept.
      if (reviewVerdict === 'fail' && (reviewAbstained || reviewAdvisory)) {
        reviewVerdict = 'pass';
      }
      // crit 6 (part 2) POST-LAND REVIEW FAIL → AUTO-REVERT. When this leaf optimistically
      // landed (small/test-pinned merged before review), a REAL post-merge fault is terminal:
      // revert the merge and park (parkBlocked owns the revert + reason card). A PROSE-GATE
      // RETRY is NOT a real fault (proseRetryFindings set ⇒ first-offense synth findings), so
      // it falls through to the normal revise loop and does NOT revert — only a terminal FAIL
      // does (part 2 §3). A prose second-offense already parked inside the review block above,
      // and that park reverts too (parkBlocked). Full tier: optimisticallyLanded is false, so
      // this is inert and the revise loop is unchanged.
      if (reviewVerdict === 'fail' && optimisticallyLanded && proseRetryFindings === null) {
        return parkBlocked(findings || 'post-land review FAIL', reviewVerdict);
      }
      // A PASS means the work is COMPLETE — accept it regardless of budget. The budget is a
      // runaway guard on doing MORE work, not a reason to DISCARD a finished, passing leaf.
      // (L6: a PASS landed on the node that tripped the budget and was wrongly thrown away
      // as node-budget-exhausted, losing complete+compiling work.)
      if (reviewVerdict === 'pass') break;
      // FAILED → we'd spend MORE nodes remediating. NOW gate on the budget.
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
      const isRepeat = findings !== '' && (findings === prevFindings || sameReviewWall(prevFindings, findings));
      if (reuses >= REVISE_REUSE_CAP || isRepeat) break; // exhausted / stuck → fresh attempt
      reuses += 1;
      prevFindings = findings;
      const fix = await runNode('implement', buildSpec('implement', cwd, blueprintBody, findings));
      checkWorkingRootEscape(cwd);
      if (fix.rateLimited) return pausedResult('implement', fix);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
      // loop → re-review the surgically-fixed tree
    }

    // LeafTier 'test-pinned' CODE-level immutability gate: a review PASS is never
    // sufficient — the reviewer judges correctness, not whether the pinned spec itself
    // was weakened. Checked structurally here, independent of and BEFORE the merge, so
    // an edited/deleted pin can never reach the epic branch.
    if (testPinnedTier && reviewVerdict === 'pass') {
      const violations = testPinViolations(testPinBaseline, hashPinnedFiles(cwd, Object.keys(testPinBaseline)));
      if (violations.length) {
        return parkBlocked(`test-pinned-immutability: pinned test file(s) modified: ${violations.join(', ')}`, reviewVerdict);
      }
    }

    if (reviewVerdict === 'pass') {
      // crit 6 (part 2 §2 + part 3): an OPTIMISTICALLY-landed leaf is ALREADY merged (before
      // review) — merge exactly ONCE, so skip this second merge and fall straight through to
      // the SAME complete/recordOutcome/finishWith bookkeeping a full-tier PASS runs. That
      // shared terminal path is what makes the accept record landing-order-invariant (the
      // mission-VERIFY gate reads ground truth + this identical 'accepted' record either way).
      if (!optimisticallyLanded) {
        // RISK (blueprint §"RISKS"): commit+merge the leaf worktree onto the epic
        // branch BEFORE proposing acceptance, so the gate's work-committed re-verify
        // sees committed work — else every PASS downgrades to 'pending'.
        try {
          await deps.mergeToEpic(
            sessionKey,
            epicId,
            `feat: ${leaf.title ?? leaf.id}`,
            leaf.id,
            { declaredFiles, untrackedAtStart },
          );
        } catch (e) {
          if (e instanceof ScopeIncidentError) {
            deps.escalate({
              project,
              session: sessionKey,
              kind: 'blocker',
              todoId: leaf.id,
              questionText:
                `Leaf "${leaf.title ?? leaf.id}" produced NO change inside its declared scope (${declaredFiles.join(', ') || 'none'}). ` +
                `Dirty-but-out-of-scope: ${e.outOfScope.slice(0, 20).join(', ')}. The blueprint's scope is wrong, or a node edited ` +
                `the wrong files. Nothing was committed.`,
            });
            return parkBlocked('scope-incident', reviewVerdict);
          }
          // Merge-back failed (e.g. conflict) → can't safely accept. Park blocked.
          return parkBlocked(
            `merge-to-epic-failed: ${e instanceof Error ? e.message : String(e)}`,
            reviewVerdict,
          );
        }
        // Work is now committed onto the epic branch. Flag it durably so a kill in the
        // narrow window before the gate completes can skip straight to the gate on a
        // future claim instead of redoing the whole leaf (consumed in slice 2).
        deps.markMerged?.(leaf.id);
      }
      const gate = await deps.complete(project, leaf.id, 'accepted');
      const effective = gate.effective ?? 'accepted';
      // RECORD THE TRUTH (§4a): the effective outcome IS the outcome — no longer
      // collapse 'pending' into 'rejected'. 'pending' = review PASSed + work merged but
      // the gate's work-committed re-verify deferred; 'rejected' = the gate failed.
      const outcome: LeafRunResult['outcome'] = effective;
      const reason =
        effective === 'pending' ? 'gate-pending'
        : effective === 'rejected' ? 'gate-rejected'
        : undefined;
      recordOutcome(outcome, reviewVerdict, {
        reason: reason ?? ([unbackedNote, constraintCiteNote, groundingNote].filter(Boolean).join('; ') || undefined),
        pendingReason: gate.pendingReason,
        gateReasons: gate.gateReasons,
      });
      return finishWith({
        outcome,
        attempts: state.attempt,
        nodesSpent: state.nodesSpent,
        ...(reason ? { reason } : {}),
      });
    }

    // REVIEW FAIL → next fresh attempt, unless the cap is exhausted.
    // SAME-WALL-TWICE first: if this attempt died on substantially the SAME findings as the
    // last one, more attempts are noise — park with the FORK named so the conductor knows
    // whether to reach for a stronger tier, a NEW-todo re-spec, or a hand-build. (Checked
    // before the cap so the reason is the informative one, not generic cap-exhausted.)
    if (lastAttemptFindings && sameReviewWall(lastAttemptFindings, attemptFinalFindings)) {
      return parkBlocked(
        'same-wall-twice: review findings repeat across fresh attempts — a different approach is needed (stronger implement tier / re-spec via a NEW todo id / hand-build), not another retry',
        reviewVerdict,
      );
    }
    if (isLastAttempt) return parkBlocked('attempt-cap-exhausted', reviewVerdict);
    lastAttemptFindings = attemptFinalFindings;
  }

  // Unreachable in practice (the loop returns), but keeps the type total.
  return parkBlocked('attempt-cap-exhausted');
  } catch (e) {
    if (e instanceof LeafAborted) {
      // Friction 552f95c2: a run aborted mid-implement never reached the post-implement
      // sweep — sweep NOW so its leaked main-checkout writes don't become permanent debris
      // that later snapshots grandfather in. Idempotent (status-diff based); best-effort.
      if (lastRootSnap) {
        try {
          const swept = sweepLeakedWrites(lastRootSnap.cwd, lastRootSnap.snap);
          if (swept.length) console.warn(`[leaf-executor] abort-path write-leak sweep relocated ${swept.length} file(s): ${swept.slice(0, 5).join(', ')}${swept.length > 5 ? ', …' : ''}`);
        } catch { /* never break the abort on the mitigation */ }
      }
      recordOutcome('aborted', null, { reason: e.abortReason ?? undefined });
      return finishWith({ outcome: 'aborted', attempts: state.attempt, nodesSpent: state.nodesSpent, reason: e.abortReason ?? undefined });
    }
    throw e;
  }
}

/** Per-attempt blueprint label (stamped into link.blueprintId). The TEXT itself lives in
 *  the worker ledger — getLatestSuccessfulNodeOutput(leafId,'blueprint') is the accessor. */
export function blueprintAttemptName(leafId: string, attempt: number): string {
  return `Leaf blueprint — ${leafId.slice(0, 8)} attempt ${attempt}`;
}
/**
 * Factory wiring the REAL dependencies. Resolves the epic id (walking parentId in
 * the tracking project), materialises the epic branch, and binds the production
 * invoker/gate/escalation/ledger. Used by the `launchWorker` leaf-executor branch.
 */
export async function makeLeafExecutorDeps(
  project: string,
  targetProject: string,
  leaf: Todo,
  /** P3 resume: carried prior nodesSpent for a known-paused leaf (default 0). */
  startNodesSpent = 0,
): Promise<LeafExecutorDeps> {
  const wm = getWorktreeManager(targetProject);
  // bf2eaf84: this run's claim token, captured at deps-construction (claim time). Threaded
  // into the terminal CAS (complete/markRejecting) so a run that lost the todo to a
  // re-claim cannot apply its outcome to the new owner. undefined ⇒ legacy status-only.
  const runClaimToken = leaf.claim?.token ?? leaf.claimToken ?? undefined;
  const epicId = resolveEpicId(leaf, project);
  // The repo's trunk branch, detected once per deps construction (git symbolic-ref HEAD,
  // falling back to the current commit on a detached/bare HEAD) — replaces the hardcoded
  // 'master' fallback so a non-master-trunk project doesn't silently diff/merge against a
  // ref that doesn't exist.
  const baseBranch = await wm.detectBaseBranch();
  // Materialise the epic accumulation branch so the off-tip base exists.
  const epic = await wm.ensureEpic(epicId, targetProject);
  const epicBranch = epic?.branch ?? baseBranch;
  // BUILD-BASE CONSISTENCY (38d87ab3): forward-integrate trunk INTO the epic branch
  // BEFORE the lane forks its build worktree off the epic tip. Claim-time reachability
  // (71cebee3) admits a foundation reachable from the epic tip OR trunk, but the lane
  // forks from the epic tip ALONE — so a foundation that landed to trunk AFTER this
  // epic branched would pass the claim gate yet be missing from the build base. The
  // forward-merge keeps the two in agreement. Conflict-safe: on conflict the epic
  // branch is left untouched, we escalate, and fall back to building on the current
  // tip (no worse than before). Best-effort — never let it block the run.
  if (epic) {
    try {
      const fi = await wm.forwardIntegrateEpic(epicId, baseBranch);
      if (fi.conflict) {
        try {
          createEscalation({
            project,
            session: leafSessionKey(leaf),
            todoId: leaf.id,
            kind: 'assumption-invalidated',
            questionText:
              `Forward-integration conflict: could not merge ${baseBranch} into epic branch ${epicBranch} before building ` +
              `"${leaf.title ?? leaf.id}" (conflicts: ${(fi.conflictedPaths ?? []).join(', ') || 'unknown'}). ` +
              `The epic branch is behind trunk and auto-merge failed — the leaf will build on the current (stale) ` +
              `epic tip. Resolve by merging ${baseBranch} into ${epicBranch} by hand, then re-run.`,
          });
        } catch { /* best-effort: never let escalation failure block the build */ }
      }
    } catch { /* best-effort: forward-integration is an optimisation, not a gate */ }
  }
  // Epic tip at run start — the base the blueprint will be authored against. Recorded
  // durably so a re-claim can reject a stale resume if the base moved (slice 2).
  const epicBaseSha = epic ? await wm.epicHeadSha(epicId) : null;
  // RESUME DECISION (slice 2): compare the durable resume row against the current
  // epic tip. fresh | skip-to-gate | reattach-blueprint. On a FRESH decision with a
  // stale row (e.g. the epic base moved under a killed run), drop the row and ignore
  // any carried budget so the clean run starts at 0; otherwise carry it forward.
  const existingResume = getLeafResume(project, leaf.id);
  // A durable blueprint output (recorded by a prior dispatch's blueprint node) means a
  // blueprint-phase pause is REUSABLE, not fresh — avoid re-running the blueprint node.
  const hasBlueprintOutput = !!getLatestSuccessfulNodeOutput(leaf.id, 'blueprint')?.trim();
  const bpRow = getLeafBlueprint(leaf.id);
  const hasCompletedImplement = !!existingResume?.phase && existingResume.phase !== 'blueprint' && existingResume.phase !== 'implement';
  const specUnchanged = !!bpRow?.specSig && bpRow.specSig === leafSpecSignature(leaf);
  const wall = getLeafWallHistory(leaf.id);
  const resumePlan = planResume(existingResume, epicBaseSha, hasBlueprintOutput, bpRow?.epicBaseSha ?? null, hasCompletedImplement, specUnchanged, { repeatedWall: wall.repeatedWall, lastReasonClass: wall.lastReasonClass });
  const anomaly = resumePlan.mode === 'fresh' && hasBlueprintOutput
    && (resumePlan.reason === 'no-resume-state' || resumePlan.reason === 'no-epic-base' || resumePlan.reason === 'killed-before-blueprint');
  recordLeafResumeDecision({ leafId: leaf.id, project, mode: resumePlan.mode, reason: resumePlan.reason,
    hadResumeRow: !!existingResume, hasBlueprintOutput, resumeBaseSha: existingResume?.epicBaseSha ?? bpRow?.epicBaseSha ?? null,
    currentEpicSha: epicBaseSha, anomaly });
  if (anomaly) console.warn('[leaf-resume] discarded a reusable blueprint', { leafId: leaf.id, reason: resumePlan.reason, currentEpicSha: epicBaseSha });
  let effectiveStart = startNodesSpent;
  if (resumePlan.mode === 'fresh' && existingResume) {
    clearLeafResume(leaf.id);
    effectiveStart = 0;
  }
  if (resumePlan.mode === 'fresh' && (resumePlan.reason === 'epic-base-moved' || resumePlan.reason === 'poisoned-blueprint-same-wall')) clearLeafBlueprint(leaf.id);
  // G2 mechanical gate, G4 abstention: classify ONCE per deps construction. `declared` runs the
  // gate; `absent` abstains LOUDLY; `misconfigured` is INFRA — never a silent pass.
  const manifestSource = loadManifestSource(targetProject);
  const gateDecl = resolveGateDeclaration(manifestSource);
  const gateCfg = gateDecl.kind === 'declared' ? gateDecl.cfg : null;
  // The FLOOR review loop calls runGate once per pass (implement→review→fix→review), but the
  // abstention is a property of the LEAF, not of the pass. Latch it so the ledger carries one
  // 'gate-abstain' row per leaf run — matching warnGateAbstention's own once-per-epic dedupe.
  let recordedGateAbstain = false;
  // L4 CITABILITY gate: memoize base line count PROMISES (path → Promise<line count>).
  // Lives in the per-run closure so it never leaks across leaves and needs no invalidation.
  // Promises are stored synchronously with .set() before any await to dedup concurrent citations.
  const baseLineCounts = new Map<string, Promise<number>>();
  // Lazy per-epic base memo for the per-file `tests` lanes: runs the SAME commands a red
  // lane just ran, but at the epic base, so `runLeafGate` can diff pre-existing-red out of
  // this leaf's verdict. Memoized in epic_base_lane per (epicId, baseSha, laneKey) — only
  // lanes that actually go red pay this cost, and only once per epic base.
  const resolveLaneBaseline = async (laneKey: string, commands: readonly string[], laneCwd?: string): Promise<string[] | null> => {
    const hit = getEpicBaseLane(epicId, epicBaseSha, laneKey);
    if (hit) return hit.failures;
    try {
      const wt = await wm.ensureEpic(epicId, targetProject);
      if (!wt) return null;
      const runCwd = laneCwd ? join(wt.path, laneCwd) : wt.path;
      const outputs: string[] = [];
      for (const command of commands) {
        const r = await defaultGateSpawn(runCwd, command);
        if (!r.ran) return null;
        if (r.code !== 0) outputs.push(r.output);
      }
      const failures = outputs.length ? outputs.flatMap((o) => extractFailingTests(o)) : [];
      recordEpicBaseLane({ epicId, baseSha: epicBaseSha ?? '', laneKey, failures, ran: true });
      return failures;
    } catch {
      return null;
    }
  };
  return {
    invoker: ClaudeNodeInvoker,
    grokInvoker: GrokNodeInvoker,
    xaiInvoker: XaiApiNodeInvoker,
    wm,
    epicId,
    epicBranch,
    baseBranch,
    epicBaseSha,
    // The MAIN checkout of the target repo — named in node prompts and the working-root
    // guard so a node can tell its worktree from the tracking root it was told about.
    mainCheckoutRoot: targetProject,
    resumePlan,
    startNodesSpent: effectiveStart,
    wallHistory: wall,
    assertAuth: assertSubscriptionAuth,
    assertGrokAuth,
    assertXaiApiAuth,
    complete: async (p, t, a) => {
      // Carry the gate's pendingReason + failing-gate reasons OUT of the funnel — the
      // leaf-executor's terminal record needs them (they were silently dropped before).
      const r = await handleWorkerComplete(makeCoordinatorDeps(), p, t, a, runClaimToken);
      return { effective: r.effective, pendingReason: r.pendingReason, gateReasons: r.gateOverride?.reasons };
    },
    mergeToEpic: (sessionKey, eId, message, todoId, scope) =>
      wm.commitAndMergeToEpic(sessionKey, eId, {
        message,
        todoId,
        scope,
        commitBoundaries: manifestSource.manifest?.commitBoundaries,
      }),
    // crit 6 auto-revert seam: undo one optimistically-landed leaf's merge on the epic
    // branch (sessionKey/todoId/reason are for the executor's audit card, not the git op).
    revertEpicMerge: (_sessionKey, eId, _leafId, mergeSha, _reason) =>
      wm.revertEpicMerge(eId, mergeSha),
    reintegrateBase: (sessionId, base) => wm.reintegrateLaneBase(sessionId, base),
    changeSet: (sessionKey) => wm.changeSet(sessionKey, epicBranch),
    // Own-prior-work probe: live git read in the TARGET repo (where every branch ref lives).
    ownWorkCommitOnEpicBranch: (input) => findOwnWorkCommitOnEpicBranch(targetProject, input),
    splitInto: async (lf, files) => { await splitLeafInto(project, lf, files); },
    escalate: createEscalation,
    proposeSplit,
    awaitSplitDecision,
    proposeContested,
    awaitContestedDecision,
    resolveProposal: resolveEscalation,
    recordNode,
    // Replay corpus (crit-5): persist every G3 / citability evaluation. Best-effort.
    recordGateEval: (p, input) => recordGateEval(p, input),
    // Shadow mode default OFF. The sibling harness leaf replaces this with the
    // runtime-config per-project reader; until then the gates behave exactly as before.
    gateShadowMode: () => false,
    setInflight: setLeafInflight,
    clearInflight: clearLeafInflight,
    persistResume: recordLeafResume,
    persistBlueprintBase: recordLeafBlueprint,
    markMerged: markLeafMerged,
    // FM1 Phase-B hardening: durably land the reject intent before the slow gate so a
    // mid-gate restart can't reclaim+re-run it (reclaimNow refuses acceptanceStatus
    // 'rejected'). Idempotent with complete()'s own terminal write.
    markRejecting: async (p, leafId) => {
      // Ownership-gated (bug aadd927b): only stamp 'rejected' if this run still OWNS the
      // todo (in_progress). Returns false when a concurrent run already took it terminal
      // (e.g. accepted) → parkBlocked discards the blocked outcome instead of clobbering.
      try {
        const { markRejectingIfOwned } = await import('./todo-store');
        return await markRejectingIfOwned(p, leafId, runClaimToken);
      } catch { return true; /* best-effort: don't change legacy behaviour on error */ }
    },
    bumpRetry: async (p, leafId) => {
      try {
        const { bumpRetryCountIfOwned } = await import('./todo-store');
        return await bumpRetryCountIfOwned(p, leafId, runClaimToken);
      } catch { return false; }
    },
    refundRetry: async (p, leafId) => {
      try {
        const { refundBaseMovedRetryIfUnderCap } = await import('./todo-store');
        const { MAX_BASE_MOVED_REFUNDS } = await import('./harness-caps');
        return await refundBaseMovedRetryIfUnderCap(p, leafId, MAX_BASE_MOVED_REFUNDS, runClaimToken);
      } catch { return false; }
    },
    holdLeaf: async (p, leafId, reason) => {
      try {
        const { holdLeafIfOwned } = await import('./todo-store');
        return await holdLeafIfOwned(p, leafId, reason, runClaimToken);
      } catch { return false; }
    },
    restoreBlueprint: (leafId) => restoreEditableBlueprint(leafId),
    // P5 size-gate seam: read back the blueprint .md (with its trailing json block).
    readBlueprint: async (cwd, lf) => {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        return await fs.readFile(path.join(cwd, blueprintPath(lf)), 'utf8');
      } catch {
        return undefined; // missing/unreadable ⇒ FLOOR fail-safe
      }
    },
    // Verify pipeline (epic f5c7fc46): read back any worktree-relative artifact (plan JSON,
    // verb result JSON). Missing/unreadable ⇒ undefined (caller falls back to node text).
    readArtifact: async (cwd, relPath) => {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        return await fs.readFile(path.join(cwd, relPath), 'utf8');
      } catch {
        return undefined;
      }
    },
    // L5: executor-owned write into the worktree (the deliverable's location must not depend
    // on the node's cwd path resolution). mkdir -p the parent, then write.
    writeArtifact: async (cwd, relPath, content) => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const full = path.join(cwd, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf8');
    },
    // L3 command-gate (epic f5c7fc46): run the config's shell gate in the worktree. A spawn
    // failure (missing tool) ⇒ ran:false (infra → block); a non-zero exit ⇒ ran:true/ok:false
    // (a finding). Output is captured (stdout+stderr) for the report.
    runCommandGate: async (cwd, command) => {
      // ASYNC spawn (mirrors defaultGateSpawn) — a command gate can run a whole test
      // suite, and a sync spawn here starves the sidecar event loop past the Electron
      // liveness watchdog (crit-6, mission 693bbc27).
      try {
        const proc = Bun.spawn(['sh', '-c', command], { cwd, stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (proc.signalCode != null) return { ran: false, ok: false, output: `${stdout}${stderr}` };
        return { ran: true, ok: code === 0, output: `${stdout}${stderr}` };
      } catch (e) {
        return { ran: false, ok: false, output: e instanceof Error ? e.message : String(e) };
      }
    },
    resolveVerifyGate,
    // crit 2 (edit-coverage): does the leaf's DECLARED tests FLIP base→branch — do the BRANCH
    // test files FAIL against the BASE implementation? Runs in an EPHEMERAL detached worktree at
    // baseSha (never touches the leaf's cwd / the epic branch), with the branch test files copied
    // in and node_modules symlinked so the runner resolves. DEFENSIVE: returns null on ANY doubt
    // (no baseSha / no tests / spawn error / can't determine) — the caller then GATES, so an
    // imperfect impl only ever costs the advisory benefit, never wrongly accepts. Best-effort v1.
    testsFlipBaseToBranch: async ({ cwd, testFiles, baseSha }) => {
      if (!baseSha || !testFiles?.length) return null;
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');
      // ASYNC bounded spawn — this runs whole test files (up to minutes); the old
      // spawnSync here held the sidecar event loop for the full run (crit-6, 693bbc27).
      const runAsync = async (
        argv: string[],
        runCwd: string,
        timeoutMs: number,
      ): Promise<{ status: number | null; failed: boolean }> => {
        try {
          const proc = Bun.spawn(argv, { cwd: runCwd, stdout: 'ignore', stderr: 'ignore' });
          const killTimer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, timeoutMs);
          try {
            const code = await proc.exited;
            if (proc.signalCode != null) return { status: null, failed: true };
            return { status: code, failed: false };
          } finally {
            clearTimeout(killTimer);
          }
        } catch {
          return { status: null, failed: true };
        }
      };
      let tmp: string | undefined;
      try {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-base-'));
        const wtDir = path.join(tmp, 'wt');
        const add = await runAsync(['git', 'worktree', 'add', '--detach', wtDir, baseSha], cwd, 60000);
        if (add.failed || add.status !== 0) return null;
        // node_modules symlinks so the runner resolves deps in the ephemeral base tree.
        try { fs.symlinkSync(path.join(targetProject, 'node_modules'), path.join(wtDir, 'node_modules')); } catch { /* best-effort */ }
        try { fs.symlinkSync(path.join(targetProject, 'ui', 'node_modules'), path.join(wtDir, 'ui', 'node_modules')); } catch { /* best-effort */ }
        // Overlay the BRANCH versions of the declared test files onto the BASE tree.
        for (const rel of testFiles) {
          const src = path.join(cwd, rel);
          if (!fs.existsSync(src)) continue;
          const dst = path.join(wtDir, rel);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
        }
        const backend = testFiles.filter((f) => !f.startsWith('ui/'));
        const uiTests = testFiles.filter((f) => f.startsWith('ui/'));
        let anyRan = false, anyFailed = false;
        if (backend.length) {
          const r = await runAsync(['bun', 'test', ...backend], wtDir, 180000);
          if (r.failed) return null;
          anyRan = true; if (r.status !== 0) anyFailed = true;
        }
        if (uiTests.length) {
          const r = await runAsync(['npx', 'vitest', 'run', ...uiTests.map((f) => f.replace(/^ui\//, ''))], path.join(wtDir, 'ui'), 240000);
          if (r.failed) return null;
          anyRan = true; if (r.status !== 0) anyFailed = true;
        }
        if (!anyRan) return null;
        return anyFailed; // branch tests FAIL against base impl ⇒ they exercise the change ⇒ COVERED
      } catch {
        return null;
      } finally {
        if (tmp) {
          await runAsync(['git', 'worktree', 'remove', '--force', path.join(tmp, 'wt')], cwd, 30000); // best-effort
          try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      }
    },
    citationLineExistsAtBase: async ({ cwd, baseSha, path, line }) => {
      if (!baseSha) return false;
      let p = baseLineCounts.get(path);
      if (p === undefined) {
        const compute = async (): Promise<number> => {
          try {
            const proc = Bun.spawn(['git', 'show', `${baseSha}:${path}`], {
              cwd,
              stdout: 'pipe',
              stderr: 'pipe',
            });
            const killTimer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, 10_000);
            try {
              const [exitCode, stdout] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).text(),
              ]);
              return exitCode === 0 ? stdout.split('\n').length : -1;
            } finally {
              clearTimeout(killTimer);
            }
          } catch {
            return -1;
          }
        };
        p = compute();
        baseLineCounts.set(path, p);
      }
      const n = await p;
      return n >= 0 && line >= 1 && line <= n;
    },
    // G2 mechanical gate at leaf HEAD. Scoped to this leaf's own change-set (against the
    // epic branch base) so the per-file test command only runs specs this leaf touched.
    runGate: async (cwd) => {
      const early = gateResultForDeclaration(gateDecl);
      if (early) return early; // misconfigured → mech.status==='error' → parkBlocked+escalate
      if (gateDecl.kind === 'absent') {
        warnGateAbstention(project, epicId, targetProject, gateDecl);
        escalateLegacyGateResidual(project, targetProject, leaf, manifestSource);
        if (!recordedGateAbstain) {
          recordedGateAbstain = true;
          try {
            recordNode({
              project,
              todoId: leaf.id,
              session: leafSessionKey(leaf),
              epicId,
              leafId: leaf.id,
              nodeKind: 'gate-abstain',
              nodesSpent: 0,
              verdict: 'pass',
              outcomeDetail: 'gate-undeclared',
              outputText: `${gateDecl.reason} (consulted ${gateDecl.manifestPath})`,
            });
          } catch { /* best-effort telemetry */ }
        }
      }
      const changeSet = await wm.changeSet(leafSessionKey(leaf), epicBranch);
      const baseGate = getEpicBaseGate(epicId, epicBaseSha);
      return runLeafGate(cwd, gateCfg, changeSet, defaultGateSpawn, baseGate?.baselineFailures ?? null, resolveLaneBaseline);
    },
    // G2 once-per-epic base gate, cached in the epic_base_gate ledger table keyed by
    // epicId ALONE (never the moving tip). A cached `pass` is terminal for its sha; a
    // cached `fail` is re-verified (bounded by shouldHonourCachedBaseGate's attempt/TTL
    // policy) rather than pinning the epic red forever on one contention/flake red.
    // `fresh:true` only on a call that actually executed the commands.
    ensureBaseGreen: async () => {
      const early = gateResultForDeclaration(gateDecl);
      if (early) return { ...early, fresh: true }; // escalate once; never cache a config error as a base fact
      return resolveBaseGreen({
        epicId,
        project,
        targetProject,
        epicBaseSha,
        gateCfg,
        // ensureEpic was already called above in this same factory — idempotent, no new
        // worktree churn. Run at the epic worktree (inside the repo ⇒ node_modules
        // resolves upward), AFTER forwardIntegrateEpic so we gate the base a leaf will
        // actually fork from.
        ensureEpicWorktree: () => wm.ensureEpic(epicId, targetProject),
        runGate: (p) => runBaseGate(p, gateCfg, defaultGateSpawn),
      });
    },
    // Live git-backed default for the floor-path base-freshness pre-check: is `epicBranch`'s
    // CURRENT tip still an ancestor of the lane worktree's HEAD? Delegates to the
    // WorktreeManager so the git plumbing lives in one place.
    worktreeBaseFresh: (cwd) => wm.worktreeBaseFresh(cwd, epicBranch),
    // Durable per-attempt blueprint LINK (best-effort; throws are swallowed at the
    // call site). The blueprint TEXT is already durably stored by the worker ledger
    // at the invoke boundary (getLatestSuccessfulNodeOutput(leafId,'blueprint') is
    // the artifact accessor the API serves from) — the old copy written into a
    // `leaf-blueprints` pseudo-session document store was redundant AND put a
    // non-watchable bookkeeping session in the picker forever. Only the todo's
    // `link.blueprintId` attempt label is stamped now. Preserves any existing taskId.
    persistBlueprint: async ({ project: trackingProject, leaf: lf, attempt }) => {
      const { updateTodo } = await import('./todo-store');
      const id = blueprintAttemptName(lf.id, attempt).replace(/[^a-zA-Z0-9-_]/g, '-');
      await updateTodo(trackingProject, lf.id, {
        link: { blueprintId: id, ...(lf.link?.taskId ? { taskId: lf.link.taskId } : {}) },
      });
      return id;
    },
  };
}
