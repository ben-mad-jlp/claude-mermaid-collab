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

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Todo } from './todo-store';
import { splitLeafInto } from './todo-store';
import type { LeafSplitItem, LeafSplitDecision } from './split-decision';
import { parseSplitDecision, topoSortSplitItems, sliceCoversFiles } from './split-decision';
import type { NodeInvoker, NodeResult, NodeSpec, AuthMode } from '../agent/node-invoker';
import type { EffortLevel } from '../agent/contracts';
import { getProjectEffort, listNodeProfileOverrides } from './orchestrator-config';
import type { WorktreeManager } from '../agent/worktree-manager';
import { ClaudeNodeInvoker, GrokNodeInvoker, assertSubscriptionAuth, assertGrokAuth } from '../agent/node-invoker';
import { XaiApiNodeInvoker, assertXaiApiAuth } from '../agent/xai-api-invoker';
import { resolveNodeProvider, anyGrokNodeConfigured, anyXaiApiNodeConfigured, grokModelForKind, xaiApiLedgerModel, resolveNodeModel } from './node-provider';
import { getWorktreeManager, resolveEpicId, makeCoordinatorDeps } from './coordinator-live';
import { handleWorkerComplete } from './coordinator-daemon';
import { createEscalation, resolveEscalation } from './supervisor-store';
import { LeafAborted, leafAbortReason, type AbortReason } from './leaf-abort';
import { proposeSplit, awaitSplitDecision, raisedNodeBudget } from './split-proposal';
import { recordNode, setLeafInflight, clearLeafInflight, recordLeafResume, markLeafMerged, getLatestNodeOutput, getLeafResume, clearLeafResume, recordEpicBaseGate, getEpicBaseGate, recordLeafBlueprint, getLeafBlueprint, clearLeafBlueprint, recordLeafResumeDecision } from './worker-ledger';
import { scopeFailureToChangeSet, isInChangeSet, lastLines } from './gate-runner';
import { COMPILE_CHECK_INSTRUCTION } from './compile-gate';
import { snapshotMainCheckout, sweepLeakedWrites, type RootSnapshot } from './worktree-write-leak';
import { stageUntrackedIntentToAdd } from './stage-untracked';
import { composeVerdict, defaultGateSpawn, runLeafGate, runBaseGate, gateFindingsText, resolveGateDeclaration, gateResultForDeclaration, type LeafGateResult } from './leaf-gate';
import { validateReviewGrounding } from './review-citations';
import { evaluateCommandEvidence, parseVerificationClaims, type RecordedCommand } from './node-commands';
import { validateCriteriaCitability } from './criteria-citability';
import { loadManifestSource } from '../config/project-manifest';
import { listUntrackedPaths, parseDeclaredScope } from './leaf-commit-scope';
import { ScopeIncidentError } from '../agent/worktree-manager';

/** Node kinds. The floor chains blueprint→implement→review (unchanged). P5 adds the
 *  wave kinds (research/wimplement/verify/fix); `'implement'` stays RESERVED for the
 *  floor so floor ledger rows are byte-identical. */
export type LeafNodeKind =
  | 'blueprint' | 'implement' | 'review' // floor (unchanged)
  | 'research' | 'wimplement' | 'verify' | 'fix' // waves (P5)
  | 'driveplan' | 'driveexec' | 'report' // verify pipeline (epic f5c7fc46)
  | 'summary'; // zen mode (design-zen-mode Phase 4): session-summary model knob

/**
 * P5 — structured size manifest the BLUEPRINT node emits as a trailing ```json
 * fenced block. Single source of truth for "what files/tasks a leaf touches";
 * ALSO consumed by the Bridge file-manifest (todo 86b2f019), so keep it
 * ADDITIVE-ONLY (bump {@link LeafSizeManifest.schemaVersion}, never repurpose a
 * field).
 */
export interface LeafSizeManifest {
  schemaVersion: number;
  estimatedFiles: number;
  estimatedTasks: number;
  nonEnumerableFanout: boolean;
  filesToCreate: string[];
  filesToEdit: string[];
  tasks: Array<{ id: string; files: string[]; description: string }>;
  /** SR-6: present iff the blueprint emitted a well-formed `splitDecision`. */
  splitDecision?: LeafSplitDecision;
  /** SR-6: true iff a `splitDecision` KEY was present but failed validation. The gate
   *  then takes the FLOOR — a malformed decision must never read as "split into N". */
  splitDecisionMalformed?: boolean;
}

// Re-export types so they're available to users of leaf-executor.ts
export type { LeafSplitItem, LeafSplitDecision } from './split-decision';

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
  assertGrokAuth?: () => AuthMode;
  /** xAI-API auth assertion (XAI_API_KEY) — pre-flighted at leaf entry when any node routes to
   *  grok-api. Default `assertXaiApiAuth`. */
  assertXaiApiAuth?: () => AuthMode;
  /** Worktree manager for the TARGET repo. */
  wm: WorktreeManager;
  /** The epic id this leaf rolls up to (per-epic accumulation branch). */
  epicId: string;
  /** The epic's accumulation branch (worktrees are cut fresh off its tip). */
  epicBranch: string;
  /** Epic tip SHA at run start — recorded into the durable resume row so a later
   *  re-claim can detect a moved base (slice 2). Best-effort; may be null. */
  epicBaseSha?: string | null;
  /** Once-per-run subscription auth assertion (throws if not the subscription). */
  assertAuth: () => AuthMode;
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
  /** Append a best-effort node-ledger row. */
  recordNode: typeof recordNode;
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
  persistBlueprintBase?: (e: { project: string; leafId: string; epicBaseSha?: string | null }) => void;
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
  /** Release a claimed leaf (infra park seam). Best-effort; unwired in tests. */
  releaseClaim?: (project: string, todoId: string) => Promise<boolean | void>;
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
  /** G2 once-per-epic base gate. Resolves the CACHED verdict for this epic, computing it on
   *  first call. `fresh` is true only on the call that actually executed the commands (so the
   *  escalation is raised once, not once per leaf). Unwired ⇒ undefined ⇒ skipped. */
  ensureBaseGreen?: () => Promise<(LeafGateResult & { fresh: boolean }) | null>;
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

export const ATTEMPT_CAP = 2;
export const NODE_BUDGET = 20;
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

/** Verify pipeline (epic f5c7fc46): the DEFAULT deterministic gate verb when a verify leaf
 *  declares no other. build_assembly_plan is the build123d driver T1–T13 built (the thing
 *  T14 dogfoods). The execute node is constrained to the resolved verb's MCP tool so the LLM
 *  invokes it but authors nothing. L3 (e9ce8693) makes the gate a pluggable {verb, command}
 *  (see {@link resolveVerifyGate}); this is just the fallback verb. */
export const VERIFY_GATE_VERB = 'build_assembly_plan';
/** Node wall-clock cap for the verify EXECUTE node. The default 600s node timeout is sized for
 *  a code node; a CAD assembly build (load vendor STEP parts → build subassemblies → run
 *  geometry/DOF/clearance gates) legitimately runs longer, and the L4 dogfood hit the 600s
 *  kill mid-build. 20min gives heavy assemblies room while still bounding a true runaway. */
export const VERIFY_EXEC_TIMEOUT_MS = 1_200_000;
/** The build123d MCP server key (its FastMCP name — `FastMCP("bsync-cad")`, registered in
 *  build123d-ocp-mcp/.mcp.json). A Claude Code node addresses its tools as
 *  `mcp__bsync-cad__<verb>`. Confirmed against the live MCP in L4. */
export const VERIFY_GATE_MCP_SERVER = 'bsync-cad';
/** Map a gate verb to the MCP-namespaced tool the execute node is allowlisted to. Kept as one
 *  function so every call site generalizes together. */
export function verbMcpTool(verb: string): string {
  return `mcp__${VERIFY_GATE_MCP_SERVER}__${verb}`;
}
/** The default verb's MCP tool — NODE_PROFILE.driveexec's static allowlist fallback. The
 *  pipeline recomputes the allowlist per-leaf from the resolved config (so a non-default verb
 *  is allowlisted correctly); this keeps the profile table total. */
export const VERIFY_GATE_MCP_TOOL = verbMcpTool(VERIFY_GATE_VERB);

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

/** One-line description of what each node kind does — surfaced in the matrix editor. */
export const NODE_KIND_DESCRIPTIONS: Record<LeafNodeKind, string> = {
  blueprint: 'Floor: plans the leaf — authors the implementation blueprint the later nodes follow.',
  implement: 'Floor: writes the code per the blueprint (single-shot).',
  review: 'Floor: reviews the implementation against the blueprint; failure drives a retry.',
  research: 'Waves: read-only investigation per task before any edits.',
  wimplement: 'Waves: implements one file/target (read + edit).',
  verify: 'Waves: checks one file (e.g. runs tsc) and reports pass/fail.',
  fix: 'Waves: fixes a file that failed verify (same error twice ⇒ stuck).',
  driveplan: 'Verify pipeline: authors an AssemblyBuildPlan — plan only, no code.',
  driveexec: 'Verify pipeline: constrained to the single deterministic gate verb; authors nothing.',
  report: 'Verify pipeline: files one todo per finding and emits the report markdown.',
  summary: 'Zen mode: summarizes a watched interactive session into a short progress summary.',
};

/** Pipeline grouping for the node-kind matrix editor (UI: DaemonNodesMatrix).
 *  The single source of truth for which kinds belong to which pipeline + when
 *  each pipeline actually fires. Ordered; Floor first. `defaultCollapsed` drives
 *  the matrix's initial expand/collapse. Kinds must partition LEAF_NODE_KINDS. */
export interface LeafNodeGroup {
  key: 'floor' | 'waves' | 'verify-cad' | 'zen';
  label: string;
  firesWhen: string;
  kinds: LeafNodeKind[];
  defaultCollapsed: boolean;
}

export const LEAF_NODE_GROUPS: LeafNodeGroup[] = [
  {
    key: 'floor', label: 'Floor', defaultCollapsed: false,
    firesWhen: 'Always — the default code-leaf path (blueprint → implement → review).',
    kinds: ['blueprint', 'implement', 'review'],
  },
  {
    key: 'waves', label: 'Waves (RETIRED)', defaultCollapsed: true,
    firesWhen: "RETIRED (2026-07-08): the fan-out path no longer runs — every leaf runs linear (FLOOR) and oversized leaves auto-split. Kept only to display historical waves runs.",
    kinds: ['research', 'wimplement', 'verify', 'fix'],
  },
  {
    key: 'verify-cad', label: 'Verify / CAD', defaultCollapsed: true,
    firesWhen: 'Only when leaf.type ∈ verify | cad-dogfood | dogfood (build-assembly geometry gate) — never for ordinary backend/ui leaves.',
    kinds: ['driveplan', 'driveexec', 'report'],
  },
  {
    key: 'zen', label: 'Zen', defaultCollapsed: true,
    firesWhen: 'Session-summary loop, not a build leaf (not configurable here).',
    kinds: ['summary'],
  },
];

export const NODE_PROFILE: Record<LeafNodeKind, { model: string; allowedTools: string; effort: EffortLevel }> = {
  blueprint: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash', effort: 'high' },
  implement: { model: 'sonnet', allowedTools: 'Read Edit Grep Glob Bash', effort: 'medium' },
  review: { model: 'opus', allowedTools: 'Read Grep Glob Bash', effort: 'high' },
  // P5 waves:
  research: { model: 'sonnet', allowedTools: 'Read Grep Glob Bash', effort: 'medium' }, // read-only (spec §12: sonnet for non-blueprint/review)
  wimplement: { model: 'sonnet', allowedTools: 'Read Edit Grep Glob Bash', effort: 'medium' }, // read+edit
  verify: { model: 'sonnet', allowedTools: 'Read Grep Glob Bash', effort: 'medium' }, // read + bash-tsc
  fix: { model: 'sonnet', allowedTools: 'Read Edit Grep Glob Bash', effort: 'medium' }, // read+edit
  // verify pipeline (epic f5c7fc46): plan authors an AssemblyBuildPlan; driveexec is
  // CONSTRAINED to the single deterministic gate verb (invokes, authors nothing); report
  // writes+commits findings and files one session-todo per finding.
  driveplan: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash', effort: 'high' },
  driveexec: { model: 'sonnet', allowedTools: `Read Write Bash ${VERIFY_GATE_MCP_TOOL}`, effort: 'medium' },
  // No Bash, no Write: the report node only READS the verdicts, files finding todos via MCP,
  // and EMITS the report markdown as its final message — the EXECUTOR writes it into the
  // worktree + commits it (L5: a node's new-file Write resolves to the project root, not the
  // worktree, so a node-written report never reaches mergeToEpic → accept reverses).
  report: { model: 'sonnet', allowedTools: 'Read Grep Glob mcp__mermaid__add_session_todo', effort: 'medium' },
  // zen mode (design-zen-mode Phase 4): summarizes a watched session's progress. Read-only;
  // emits the summary as its final message (consumed by Z7). Default sonnet (claude-sonnet-4-6).
  summary: { model: 'sonnet', allowedTools: 'Read Grep Glob', effort: 'low' },
};

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

/** Fixed in-worktree path the blueprint node writes to and the later nodes read. */
function blueprintPath(leaf: Todo): string {
  return `.collab/leaf-blueprints/${leaf.id}.md`;
}

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

/** Verify pipeline artifacts (epic f5c7fc46), all worktree-relative. The plan node writes
 *  the AssemblyBuildPlan; the execute node writes the verb's raw result; the report node
 *  writes the committed findings report. The first two are read back deterministically so
 *  the gate parses the verb's TRUE output, not the model's prose. */
function verifyPlanPath(leaf: Todo): string {
  return `.collab/leaf-verify/${leaf.id}.plan.json`;
}
function verifyResultPath(leaf: Todo): string {
  return `.collab/leaf-verify/${leaf.id}.result.json`;
}
function verifyReportPath(leaf: Todo): string {
  return `docs/verify/${leaf.id}.report.md`;
}

/** The committed deliverable of a `review`-shape leaf (epic d8ac1a18 dogfood): a
 *  completeness-review report over the epic's union change-set. Worktree-relative;
 *  the executor writes + commits it (the node only emits the markdown), so the
 *  completion gate's work-committed re-verify sees real work. */
function reviewReportPath(leaf: Todo): string {
  return `docs/review/${leaf.id}.report.md`;
}

/** Build the inline prompt for a node kind (clones the LOGIC of vibe-blueprint /
 *  vibe-go worker / vibe-review as a self-contained string — references NOTHING
 *  in skills/). */
export function buildNodePrompt(
  kind: LeafNodeKind,
  leaf: Todo,
  blueprintText?: string,
  reviewFindings?: string,
): string {
  const title = leaf.title ?? leaf.id;
  const description = leaf.description ?? '(no description)';
  const bp = blueprintPath(leaf);
  switch (kind) {
    case 'blueprint':
      return [
        'You are the BLUEPRINT node for ONE leaf todo. Do NOT write implementation code.',
        `Title: ${title}`,
        `Description: ${description}`,
        'Read the relevant code (Read/Grep/Glob and Bash for inspection ONLY — no mutations).',
        `Produce a precise, self-contained implementation blueprint and WRITE it to \`${bp}\`.`,
        'The blueprint must cite the real files/symbols to touch and the exact change shape.',
        '',
        'FINISH the blueprint file with EXACTLY ONE trailing fenced ```json block (the',
        'machine-readable size manifest — the prose blueprint goes above it). It MUST be',
        'the LAST json fence in the file and parse as:',
        '```json',
        '{ "schemaVersion": 1, "estimatedFiles": <int>, "estimatedTasks": <int>,',
        '  "nonEnumerableFanout": <bool>,',
        '  "filesToCreate": ["<path>"], "filesToEdit": ["<path>"],',
        '  "tasks": [ { "id": "<slug>", "files": ["<path>"], "description": "<one line>" } ],',
        '  "splitDecision": { "split": <bool>, "reason": "<why>",',
        '    "items": [ { "id": "<slug>", "files": ["<path>"], "dependsOn": ["<slug>"] } ] } }',
        '```',
        'estimatedFiles = total distinct files created+edited. estimatedTasks = number of',
        'independent units of work. nonEnumerableFanout = true ONLY if there are sites you',
        'CANNOT statically enumerate (dynamic dispatch, string-keyed/reflective call sites).',
        '',
        'YOU decide whether this leaf is decomposable — a file count cannot see coupling, you can.',
        '`splitDecision.split: false` ⇒ the leaf runs WHOLE in one worker, even at 12 files. Choose',
        'this whenever the change is COUPLED: a shared primitive that call sites must be written',
        'against, a lock protocol, a two-sided predicate. State that invariant in `reason`.',
        '`splitDecision.split: true` ⇒ EVERY item becomes ONE child leaf, and `dependsOn` becomes a',
        'REAL dependency edge between them (a child whose dep is unmet cannot be claimed). An item MAY',
        'hold several files — group them by INDEPENDENT UNIT, not one-per-file. A module and the tests',
        'that import it are NOT independent: the test item dependsOn the module item. `dependsOn` ids',
        'must reference sibling item ids, and the graph must be acyclic. Omit `items` when split:false.',
        'Prefer `split: false` when in doubt — an unsound split races; a whole leaf merely runs longer.',
        '',
        `ALSO output the COMPLETE blueprint (the same prose + the trailing json block) as your`,
        `FINAL reply message — verbatim — so the executor has the blueprint even if the file`,
        `read fails. (Write the file AND emit the full text as your final message.)`,
      ].join('\n');
    case 'implement':
      return [
        'You are the IMPLEMENT node. Make REAL, compiling code edits (Read/Edit only).',
        reviewFindings
          ? `A PRIOR review of the EXISTING working tree FAILED. KEEP the correct work already present and make the SMALLEST changes that address ONLY these findings — do not rewrite from scratch:\n--- REVIEW FINDINGS ---\n${reviewFindings}\n--- END FINDINGS ---`
          : '',
        blueprintText
          ? `This leaf's blueprint is inlined below — implement it FULLY against the working tree. Do NOT search for, glob, or read ANY other blueprint file (other leaves' blueprints may be present in shared dirs — ignore them entirely).\n\n=== BLUEPRINT (${leaf.id}) START ===\n${blueprintText}\n=== BLUEPRINT END ===`
          : `Read the blueprint at \`${bp}\` — ONLY that exact file (ignore any other blueprint in the directory) — and the files it references, then implement it FULLY.`,
        'Do not stub or leave TODOs. Do NOT run the acceptance gate or report completion —',
        'the executor drives the gate. Just make the edits the blueprint specifies.',
        `If you spot-check compilation: ${COMPILE_CHECK_INSTRUCTION}`,
      ].filter(Boolean).join('\n');
    case 'review':
      return [
        'You are the REVIEW node, READ-ONLY (Read/Grep/Glob and Bash for inspection ONLY; no edits).',
        blueprintText
          ? `Compare the working tree against THIS leaf's blueprint, inlined below (do NOT read any other blueprint file — ignore strays in shared dirs):\n\n=== BLUEPRINT (${leaf.id}) START ===\n${blueprintText}\n=== BLUEPRINT END ===`
          : `Compare the working tree against the blueprint at \`${bp}\` (ONLY that exact file).`,
        'Decide if the work is complete and correct (it compiles, satisfies the blueprint, no obvious bugs).',
        COMPILE_CHECK_INSTRUCTION,
        'A file that fails ONLY under a bare-file `tsc <file>` run (not the project config) is NOT a real failure.',
        'Emit a `## CRITERIA` section: ONE line per acceptance criterion in the blueprint/spec, in this exact shape:',
        '`- [MET] <criterion> — <path>:<line>`  or  `- [UNMET] <criterion> — <path>:<line>`  or  `- [N/A] <criterion> — <why>`',
        'Every MET/UNMET line MUST carry at least one `file:line` citation into a file THIS leaf changed —',
        'the line you actually read to decide. Cite both sides when a criterion spans two files.',
        'A citation is not a formality: a criterion you cannot cite, you did not check.',
        'Be as TERSE as the change deserves — a one-line diff earns a one-line review. There is no',
        'length requirement and none will be inferred; only the citations are checked.',
        'End your reply with EXACTLY one line, nothing after it:',
        '`VERDICT: PASS`  (if complete and correct)',
        '`VERDICT: FAIL — <reason>`  (otherwise)',
      ].join('\n');
    default:
      // Verify-pipeline kinds (driveplan/driveexec/report) are built by buildVerifyPrompt;
      // the retired wave kinds (research/wimplement/verify/fix) are never spawned. Neither
      // reaches here — this switch is exhaustive over the FLOOR kinds it owns.
      throw new Error(`buildNodePrompt: unsupported floor kind "${kind}"`);
  }
}

/** SR-7: Build the refresh prompt for a split child's BLUEPRINT node. The child reconciles
 *  the inherited parent plan against the current tree (reading only its file slice) rather
 *  than re-deriving from zero. The prompt inlines the parent's durable plan and the child's
 *  file slice, and instructs the node to RECONCILE (tree wins on disagreements, don't re-derive). */
export function buildBlueprintRefreshPrompt(leaf: Todo, inheritedText: string, files: string[]): string {
  const title = leaf.title ?? leaf.id;
  const description = leaf.description ?? '(no description)';
  const bp = blueprintPath(leaf);
  return [
    'You are the BLUEPRINT REFRESH node for ONE split child leaf. Do NOT write implementation code.',
    `Title: ${title}`,
    `Description: ${description}`,
    `You own EXACTLY these files: ${files.join(', ')}.`,
    '',
    'The parent plan you inherited (below) was authored BEFORE your sibling leaves landed. RECONCILE',
    'it against the CURRENT tree: read the files you own and the interfaces your dependencies actually',
    'shipped. Where the inherited prose disagrees with the tree, the TREE wins. Do not re-derive the',
    'design from zero.',
    '',
    `=== INHERITED PARENT PLAN (${leaf.inheritedBlueprintFrom}) START ===`,
    inheritedText,
    '=== INHERITED PARENT PLAN END ===',
    '',
    `Produce your reconciliation and WRITE it to \`${bp}\`.`,
    'The blueprint must cite the real files/symbols to touch and the exact change shape.',
    '',
    'FINISH the blueprint file with EXACTLY ONE trailing fenced ```json block (the machine-readable',
    'size manifest — the prose blueprint goes above it). It MUST be the LAST json fence in the file',
    'and parse as:',
    '```json',
    '{ "schemaVersion": 1, "estimatedFiles": <int>, "estimatedTasks": <int>,',
    '  "nonEnumerableFanout": <bool>,',
    '  "filesToCreate": ["<path>"], "filesToEdit": ["<path>"],',
    '  "tasks": [ { "id": "<slug>", "files": ["<path>"], "description": "<one line>" } ],',
    '  "splitDecision": { "split": <bool>, "reason": "<why>",',
    '    "items": [ { "id": "<slug>", "files": ["<path>"], "dependsOn": ["<slug>"] } ] } }',
    '```',
    'estimatedFiles = total distinct files created+edited. estimatedTasks = number of',
    'independent units of work. nonEnumerableFanout = true ONLY if there are sites you',
    'CANNOT statically enumerate (dynamic dispatch, string-keyed/reflective call sites).',
    '',
    'Emit `splitDecision.split: false` unless your slice genuinely decomposes further — you are',
    'already a split child.',
    '',
    `ALSO output the COMPLETE blueprint (the same prose + the trailing json block) as your`,
    `FINAL reply message — verbatim — so the executor has the blueprint even if the file`,
    `read fails. (Write the file AND emit the full text as your final message.)`,
  ].join('\n');
}

/** L4: Build the repair prompt for a blueprint node that emitted uncitable acceptance criteria.
 *  The prompt quotes each offending criterion with its rule-violation reason, restates the
 *  rules, and demands the full blueprint be rewritten to the same path with the same trailing
 *  json manifest. Used as a one-shot in-place repair before the implement node is spawned. */
export function buildCriteriaRepairPrompt(
  leaf: Todo,
  blueprintText: string,
  citability: { verdicts: Array<{ text: string; kind?: string; reason?: string }>; offenders: Array<{ text: string; kind?: string; reason?: string }>; reasons: string[] },
): string {
  const title = leaf.title ?? leaf.id;
  const description = leaf.description ?? '(no description)';
  const bp = blueprintPath(leaf);

  const offenderText = citability.offenders
    .map(
      (o) =>
        `- "${o.text.slice(0, 80)}${o.text.length > 80 ? '...' : ''}" — ${o.reason || 'uncitable'}`,
    )
    .join('\n');

  return [
    'You are the BLUEPRINT node. Make REAL, compiling code edits.',
    `Title: ${title}`,
    `Description: ${description}`,
    '',
    'The prior blueprint you wrote has UNCITABLE acceptance criteria:',
    '',
    offenderText,
    '',
    "Every acceptance criterion in a blueprint must be satisfiable by a `file:line` citation inside the diff this leaf produces.",
    "These three criterion types are NEVER citable in principle:",
    "1. A command's result: a criterion that invokes a build/test (bun run, npm test, npx vitest, tsc, make, etc.) or asserts its outcome (tests pass, suite green, build clean, etc.).",
    "2. An absence: a criterion that asserts a negative about code (no file touched, no field added, not changed, etc.).",
    "3. A location outside your diff: a citation to a file:line you do not modify.",
    '',
    "Restate each uncitable criterion as the OBSERVABLE CODE CHANGE that would make a command pass or an absence true.",
    "Then read the relevant code, and produce your corrected blueprint and WRITE it to `" +
      bp +
      "`.",
    "The blueprint must cite the real files/symbols to touch and the exact change shape.",
    '',
    "FINISH the blueprint file with EXACTLY ONE trailing fenced ```json block (the machine-readable size manifest — the prose blueprint goes above it). It MUST be the LAST json fence in the file and parse as:",
    '```json',
    '{ "schemaVersion": 1, "estimatedFiles": <int>, "estimatedTasks": <int>,',
    '  "nonEnumerableFanout": <bool>,',
    '  "filesToCreate": ["<path>"], "filesToEdit": ["<path>"],',
    '  "tasks": [ { "id": "<slug>", "files": ["<path>"], "description": "<one line>" } ],',
    '  "splitDecision": { "split": <bool>, "reason": "<why>",',
    '    "items": [ { "id": "<slug>", "files": ["<path>"], "dependsOn": ["<slug>"] } ] } }',
    '```',
    '',
    `ALSO output the COMPLETE blueprint (the same prose + the trailing json block) as your FINAL reply message — verbatim — so the executor has the blueprint even if the file read fails.`,
  ].join('\n');
}

/** Build the inline prompt for a VERIFY-pipeline node (epic f5c7fc46). Three kinds:
 *  - driveplan: LLM authors an AssemblyBuildPlan (plan ONLY — no build, no code).
 *  - driveexec: constrained to the single deterministic gate verb — invokes it with the
 *    plan VERBATIM and captures the raw result (authors nothing).
 *  - report: writes + commits a findings .md and files one session-todo per finding.
 *  Self-contained strings (reference nothing in skills/), mirroring buildNodePrompt. */
export function buildVerifyPrompt(
  kind: 'driveplan' | 'driveexec' | 'report',
  leaf: Todo,
  /** driveexec/report: the authored plan JSON, inlined so the node never re-derives it. */
  planText?: string,
  /** report: the gate's FAILED-verdict reasons (one finding each); empty ⇒ clean pass. */
  gateFindings?: string,
  /** L3: the resolved deterministic gate verb the plan/execute nodes target. Defaults to the
   *  build_assembly_plan fallback so existing callers/tests are unaffected. */
  verb: string = VERIFY_GATE_VERB,
): string {
  const title = leaf.title ?? leaf.id;
  const description = leaf.description ?? '(no description)';
  const planFile = verifyPlanPath(leaf);
  const resultFile = verifyResultPath(leaf);
  const reportFile = verifyReportPath(leaf);
  switch (kind) {
    case 'driveplan':
      return [
        'You are the PLAN node for a VERIFY/dogfood leaf. You author a structured verify PLAN',
        'ONLY — you do NOT build anything, drive any CAD verb, or write code.',
        `Title: ${title}`,
        `Description: ${description}`,
        'Read whatever you need to understand the target (Read/Grep/Glob, Bash for inspection only).',
        `Author a single AssemblyBuildPlan — the input schema of the \`${verb}\` verb — for`,
        `the target described above and WRITE it as JSON to \`${planFile}\`.`,
        'The plan is a DAG: `{ "nodes": [ { "id", "op", "params", "deps", "accept", "assembly_path?" } ],',
        '"metadata": {} }`, where `op` ∈ realize|connect|author|subassembly and each node\'s `accept`',
        'lists the gates to assert from {validity, dof, mobility, clearance, contract}. EVERY node that',
        'should be verified MUST declare its `accept` gates — a node with no gates verifies nothing.',
        `It must be a complete, self-contained plan the deterministic \`${verb}\` verb runs in ONE call.`,
        'Do not leave placeholders.',
        '',
        'ALSO emit the COMPLETE plan JSON as your FINAL reply message, verbatim, so the executor has',
        'it even if the file read fails. Output ONLY the plan (write the file AND emit the full JSON).',
      ].join('\n');
    case 'driveexec':
      return [
        `You are the EXECUTE node. Your ONLY job: call the deterministic \`${verb}\` MCP`,
        'verb with the EXACT plan below and capture its raw result. Author NOTHING, do not modify the',
        'plan, do not build anything yourself, make exactly ONE verb call.',
        planText
          ? `=== ASSEMBLY BUILD PLAN (${leaf.id}) START ===\n${planText}\n=== PLAN END ===`
          : `Read the plan JSON at \`${planFile}\` and use it verbatim.`,
        `Call \`${verb}\` with that plan. Then WRITE the verb's COMPLETE raw JSON PlanReport result`,
        '(the full {ok, error, halted_at, nodes:[{gates:[...]}]} object, verbatim, no edits, no',
        `commentary) to \`${resultFile}\`. Also echo that same raw JSON as your final message. Do NOT`,
        'interpret, summarize, or "fix" the result — the executor parses it.',
      ].join('\n');
    case 'report':
      return [
        'You are the REPORT node for a verify/dogfood leaf. The deterministic gate has already run.',
        planText ? `The plan that was executed:\n${planText}` : '',
        gateFindings && gateFindings.trim()
          ? `The gate reported these FAILED verdicts — each is a finding:\n--- FINDINGS ---\n${gateFindings}\n--- END FINDINGS ---`
          : 'The gate reported a CLEAN result (all accept gates passed — validity/dof/mobility/clearance/contract).',
        'Compose a findings report (markdown): what was verified, the overall verdict, and each',
        'finding with enough detail to act on (and how to reproduce).',
        'For EACH distinct finding, file one session-todo via the collab MCP tool',
        '`mcp__mermaid__add_session_todo` (title = the finding, description = detail + repro) if that',
        'tool is available; if it is not, include the would-be todos as a section in the report.',
        'OUTPUT the COMPLETE report markdown as your FINAL reply message, verbatim — that final',
        'message IS the deliverable: the executor writes it to the worktree and commits it onto the',
        'epic branch. Do NOT write files yourself and do NOT run git — just emit the markdown and',
        'file the todos. (Do not edit any source code.)',
      ].filter(Boolean).join('\n');
  }
}

/** Build the inline prompt for a REVIEW-shape leaf (epic d8ac1a18 dogfood): a single
 *  read-only LLM judgment node that reviews the EPIC's union change-set against the leaf's
 *  spec (the spec is inlined — it carries the LOCKED DECISIONS), files one session-todo per
 *  gap, and EMITS the full report markdown as its final message (the executor writes +
 *  commits it — a node Write resolves to the project root, not the worktree, so a
 *  node-written report never reaches mergeToEpic → accept reverses; same L5 gotcha as
 *  verify's report node). The trailing `VERDICT:` line is the content gate that re-arms the
 *  hallucination guard at the content layer (a vacuous report has no parseable verdict →
 *  the executor parks it blocked). Teaches the three-dot diff caveat (lesson 5) and verify
 *  discipline (lesson 1). Self-contained (references nothing in skills/). */
export function buildReviewPrompt(leaf: Todo, baseRef: string): string {
  const title = leaf.title ?? leaf.id;
  const spec = leaf.description ?? '(no spec provided)';
  return [
    'You are the REVIEW node for a COMPLETENESS REVIEW leaf, READ-ONLY (Read/Grep/Glob and',
    'Bash for inspection ONLY — make NO edits, do NOT run git commit/push, do NOT run the',
    'acceptance gate). The executor commits your report for you.',
    `Title: ${title}`,
    '',
    'REVIEW SPEC (the acceptance criteria — it carries the LOCKED DECISIONS to check against):',
    '--- SPEC START ---',
    spec,
    '--- SPEC END ---',
    '',
    'You are reviewing the UNION change-set of the whole epic (all sibling leaves\' work,',
    `accumulated on this branch). Inspect it with git from the repo root:`,
    `  • the file list:  \`git diff --stat ${baseRef}...HEAD\``,
    `  • the full diff:  \`git diff ${baseRef}...HEAD\``,
    `  • per-commit log: \`git log --oneline ${baseRef}..HEAD\``,
    'CAVEAT — three-dot diff shows COMMITS ONLY. `git diff <base>...HEAD` can never show',
    'uncommitted or unstaged work, and no staging trick makes it. If a sibling leaf left work',
    'in the working tree, only `git status --porcelain` (which collapses a new directory to',
    '`?? dir/`) and `git diff HEAD` will see it. Check the working tree before concluding a',
    'file is absent.',
    `(If \`${baseRef}\` is not resolvable, fall back to \`git merge-base HEAD @{u} 2>/dev/null\` or`,
    'review the working tree directly — do the best honest review you can and SAY which base you used.)',
    'Read the actual changed source to confirm behavior — do not review from the diff alone.',
    '',
    'VERIFY DISCIPLINE — a verdict needs a BASELINE. If the change-set has tests:',
    `  1. Run each relevant test file ALONE on this branch, using this project's own test runner.`,
    `  2. Run that SAME file ALONE on \`${baseRef}\` (a worktree/checkout of the base).`,
    '  3. Compare. A failure present on BOTH is pre-existing and is NOT your finding.',
    'Do NOT judge from a whole-directory run: files share a SQLite database and the runner',
    'parallelizes, so aggregate red/green is noise. One file, in isolation, on both sides.',
    '',
    'Judge COMPLETENESS and CORRECTNESS against the spec: flag every gap, contradiction, or',
    'unmet LOCKED DECISION. Do NOT propose new behavior or scope; this is a review, not a redesign.',
    '',
    'For EACH distinct gap/finding, file one session-todo via the collab MCP tool',
    '`mcp__mermaid__add_session_todo` (title = the finding, description = detail + where + why it',
    'matters) if that tool is available; if it is not, list the would-be todos as a section in the report.',
    '',
    'Then compose a REVIEW REPORT (markdown): what was reviewed (and the diff base you used), the',
    'per-decision check results, and each finding with enough detail to act on.',
    '',
    'If you ran any command to verify a criterion, list it under a VERIFICATION: heading,',
    'one `- ran: <exact command>` line each. The executor records what actually ran at the',
    'spawn boundary and cross-checks; a listed command it never observed is flagged. Do not',
    'list a command you did not run. If you ran nothing, omit the block.',
    '',
    'End your reply with EXACTLY one line, nothing after it:',
    '`VERDICT: PASS`  (the change-set fully satisfies the spec — no material gaps)',
    '`VERDICT: FAIL — <one-line summary>`  (material gaps exist; they are filed as todos above)',
    'OUTPUT the COMPLETE report markdown (ending with that VERDICT line) as your FINAL reply',
    'message, verbatim — that final message IS the deliverable the executor commits.',
  ].join('\n');
}

/** Extract + validate the LAST ```json fence from any of the given sources into a
 *  {@link LeafSizeManifest}. FAIL-SAFE: ANY failure (no fence, JSON error, bad
 *  types) ⇒ returns null; a null manifest ⇒ the FLOOR (linear) fail-safe, an oversized
 *  one (> SPLIT_CEILING enumerated files) ⇒ pre-flight auto-split.
 *  Mirrors parseVerdict's fail-closed posture; never throws. Exported (shared with
 *  the Bridge file-manifest, todo 86b2f019). */
export function parseSizeManifest(
  ...sources: Array<string | undefined>
): LeafSizeManifest | null {
  for (const src of sources) {
    if (!src) continue;
    const fences = [...src.matchAll(/```json\s*([\s\S]*?)```/g)];
    if (fences.length === 0) continue;
    const last = fences[fences.length - 1][1];
    try {
      const raw = JSON.parse(last) as Record<string, unknown>;
      const estimatedFiles = raw.estimatedFiles;
      const estimatedTasks = raw.estimatedTasks;
      const nonEnumerableFanout = raw.nonEnumerableFanout;
      if (
        typeof estimatedFiles !== 'number' || !Number.isFinite(estimatedFiles) || estimatedFiles < 0 ||
        typeof estimatedTasks !== 'number' || !Number.isFinite(estimatedTasks) || estimatedTasks < 0 ||
        typeof nonEnumerableFanout !== 'boolean'
      ) {
        continue;
      }
      const toStrArr = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      const tasksRaw = Array.isArray(raw.tasks) ? (raw.tasks as unknown[]) : [];
      const tasks = tasksRaw
        .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>) : {}))
        .map((t) => ({
          id: typeof t.id === 'string' ? t.id : '',
          files: toStrArr(t.files),
          description: typeof t.description === 'string' ? t.description : '',
        }));
      // SR-6: parse the optional splitDecision. A key present but malformed → tri-state.
      const hasKey = Object.prototype.hasOwnProperty.call(raw, 'splitDecision');
      const decision = hasKey ? parseSplitDecision(raw.splitDecision) : null;
      return {
        schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
        estimatedFiles,
        estimatedTasks,
        nonEnumerableFanout,
        filesToCreate: toStrArr(raw.filesToCreate),
        filesToEdit: toStrArr(raw.filesToEdit),
        tasks,
        ...(decision ? { splitDecision: decision } : {}),
        ...(hasKey && !decision ? { splitDecisionMalformed: true } : {}),
      };
    } catch {
      /* not parseable — try the next source, else fall through to null */
    }
  }
  return null;
}


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

/** The verify pipeline's domain gate, made PLUGGABLE in L3 (epic f5c7fc46 e9ce8693). A gate
 *  is a deterministic VERB (an MCP tool the execute node calls — its returned geometry/DOF/
 *  clearance verdicts are parsed by {@link parseVerifyGate}) and/or an optional COMMAND (a
 *  shell gate, e.g. `pytest -q`, composed AFTER the verb gate). This is the single seam other
 *  verify configs extend through: cartographer spec-sync (verb: check_graph_drift), asset-gen
 *  fitness, a pure-pytest dogfood — each lands as a CONFIG here with ZERO new dispatch in
 *  runVerifyPipeline (the hygiene that keeps a future recipe-registry extraction cheap). */
export interface VerifyGateConfig {
  /** The deterministic MCP verb the execute node invokes. Defaults to {@link VERIFY_GATE_VERB}. */
  verb: string;
  /** Optional shell command gate run in the worktree AFTER the verb gate; its non-zero exit is
   *  a FINDING (not an executor failure), composed into the report alongside the verb verdicts. */
  command?: string;
}

/** Resolve a verify leaf's gate config. L3 keys off `leaf.type`; today every verify type maps
 *  to the build_assembly_plan verb (no command), so this is behavior-identical to L2 — the
 *  POINT is the extension seam, not new routing. Add a case here (not new pipeline code) to
 *  introduce a new verify gate. Pure + unit-testable. */
export function resolveVerifyGate(leaf: Todo): VerifyGateConfig {
  // (future) switch on (leaf.type ?? '').toLowerCase() to pick verb/command per domain.
  return { verb: VERIFY_GATE_VERB };
}

/** Strip the markdown wrapping a model often adds around a sentinel line — the prompts
 *  SHOW the sentinels in backticks, so the model echoes the backticks (and sometimes
 *  bold or quotes). A line-anchored regex then misses the sentinel and a clean/pass
 *  result reads as a failure (the L4 waves-file-stuck false-stuck). Normalize first;
 *  newlines are kept so line-anchored matching still works. */
function stripSentinelFmt(text: string): string {
  return text.replace(/[`*_"']/g, '');
}

/** The floor pipeline's review verdict. TRI-STATE, mirroring {@link VerifyGateVerdict}:
 *  - 'pass'  — a parseable `VERDICT: PASS` line.
 *  - 'fail'  — a parseable `VERDICT: FAIL` line: a real FINDING, feed it back to implement.
 *  - 'error' — empty/whitespace, or NO parseable VERDICT line at all: the reviewer said
 *              NOTHING. An INFRA failure, NOT a finding → park blocked (bug 80bacbc4: an
 *              empty provider response read as 'fail', so the executor re-ran implement
 *              against phantom findings and livelocked to node-budget exhaustion).
 *  Fail-closed is preserved: an 'error' is never an accept. Anything that is neither an
 *  explicit PASS nor an explicit FAIL is 'error' — a terse-but-real verdict is a PASS/FAIL
 *  line and is handled here; judging a review's DEPTH is out of scope (G2/G3). */
export type LeafReviewVerdict = 'pass' | 'fail' | 'error';

export function parseVerdict(text: string | undefined): LeafReviewVerdict {
  if (!text || !text.trim()) return 'error';
  const m = stripSentinelFmt(text).match(/^\s*VERDICT:\s*(PASS|FAIL)\b/im);
  if (!m) return 'error';
  return m[1].toUpperCase() === 'PASS' ? 'pass' : 'fail';
}

/** A base-gate verdict is a durable BASE FACT only when the gate actually RAN.
 *  status==='error' means the gate could not run (missing npx, OOM, signal kill) — an
 *  INCIDENT, not a fact about the base. Caching it under the tip-less epicId key would
 *  silently block every later leaf on the epic (they read fresh:false ⇒ no escalation).
 *  Re-check on the next leaf instead. */
export function isCacheableBaseGateStatus(
  status: 'pass' | 'fail' | 'error',
): status is 'pass' | 'fail' {
  return status !== 'error';
}

/** The verify pipeline's domain-gate verdict (epic f5c7fc46), derived purely from the
 *  deterministic verb's raw JSON result. Three outcomes:
 *  - 'pass'  — gate(s) actually ran and all passed.
 *  - 'fail'  — gate(s) ran, at least one failed (or the plan errored/halted) → real findings.
 *  - 'error' — no usable result (empty / unparseable / NO gate ran = vacuous): an INFRA
 *              failure, NOT a finding → park blocked. The vacuous-result case is exactly the
 *              build123d T14 failure this epic fixes (a clean-looking result that verified
 *              nothing), so a result with zero gates is an error, never a silent pass. */
export interface VerifyGateVerdict {
  status: 'pass' | 'fail' | 'error';
  reasons: string[];
}

/** Extract the JSON object from a node's echoed result, tolerant of surrounding prose. The
 *  driveexec node often wraps the PlanReport in commentary ("Raw result:", a ```json fence,
 *  an "Execution note:" trailer), so a whole-string fence match is too strict. Prefer a fenced
 *  block anywhere; else fall back to the outermost {...}. */
function unfenceJson(text: string): string {
  const t = text.trim();
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenced && fenced[1].includes('{')) return fenced[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) return t.slice(first, last + 1);
  return t;
}

/** Parse build_assembly_plan's raw PlanReport result into a {@link VerifyGateVerdict}. Pure +
 *  unit-testable, tolerant of markdown-fenced JSON. The real shape (confirmed L4 against the
 *  bsync-cad MCP) is:
 *    { ok: bool, error: str|null, halted_at: str|null,
 *      nodes: [ { node, op, ok, detail, attempts, repairs,
 *                 gates: [ { name, passed, detail } ] } ] }
 *  where gate `name` ∈ {validity, dof, mobility, clearance, contract}. A finding is any gate
 *  with passed:false, plus a top-level error/halt. PASS requires ≥1 gate ran AND none failed
 *  AND ok!==false. Zero gates ⇒ 'error' (vacuous — verified nothing). */
export function parseVerifyGate(resultText: string | undefined): VerifyGateVerdict {
  if (!resultText || !resultText.trim()) {
    return { status: 'error', reasons: ['verify-gate: empty verb result'] };
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(unfenceJson(resultText)) as Record<string, unknown>;
  } catch {
    return { status: 'error', reasons: ['verify-gate: unparseable verb result (not JSON)'] };
  }
  if (!raw || typeof raw !== 'object') {
    return { status: 'error', reasons: ['verify-gate: verb result is not a JSON object'] };
  }
  const reasons: string[] = [];
  // Top-level plan error / halt (the plan itself was rejected or execution stopped).
  if (typeof raw.error === 'string' && raw.error) {
    const halt = typeof raw.halted_at === 'string' && raw.halted_at ? ` (halted at ${raw.halted_at})` : '';
    reasons.push(`plan error: ${raw.error}${halt}`);
  }
  // Walk every node's gates; count how many actually ran (the anti-vacuous guard).
  let gatesRan = 0;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const node = n as Record<string, unknown>;
    const nodeId = typeof node.node === 'string' ? node.node : '?';
    const gates = Array.isArray(node.gates) ? node.gates : [];
    for (const g of gates) {
      if (!g || typeof g !== 'object') continue;
      const gate = g as Record<string, unknown>;
      gatesRan += 1;
      if (gate.passed === false) {
        const name = typeof gate.name === 'string' ? gate.name : 'gate';
        const detail = typeof gate.detail === 'string' && gate.detail ? `: ${gate.detail}` : '';
        reasons.push(`${nodeId} / ${name} failed${detail}`);
      }
    }
    // A node that failed without surfacing a failed gate is still a finding.
    if (node.ok === false && gates.every((g) => !g || typeof g !== 'object' || (g as Record<string, unknown>).passed !== false)) {
      const detail = typeof node.detail === 'string' && node.detail ? `: ${node.detail}` : '';
      reasons.push(`node ${nodeId} failed${detail}`);
    }
  }
  // Vacuous result — nothing was actually gated. Never a silent pass (the T14 failure mode).
  if (gatesRan === 0 && reasons.length === 0) {
    return { status: 'error', reasons: ['verify-gate: no gates ran (vacuous result — verified nothing)'] };
  }
  // Top-level ok:false with no other reason captured.
  if (raw.ok === false && reasons.length === 0) reasons.push('plan reported ok:false');
  return { status: reasons.length ? 'fail' : 'pass', reasons };
}


/** Stable per-leaf lane name. WorktreeManager keys records on this; `fresh:true`
 *  tears down the prior dir+branch so every attempt is a NEW branch off the tip. */
export function leafSessionKey(leaf: Todo): string {
  return `leaf-exec-${leaf.id.slice(0, 8)}`;
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
export type ResumeMode = 'fresh' | 'skip-to-gate' | 'reattach-blueprint';
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
 * - epic base missing/moved        → fresh (the blueprint was authored against the
 *                                     old tip; resuming against a changed world is
 *                                     Grok's #1 risk — never do it)
 * - blueprint done + base unchanged→ reattach-blueprint (reuse the DURABLE blueprint
 *                                     plan in a FRESH worktree, re-run implement→
 *                                     review; saves the ~4.5min blueprint without
 *                                     reusing any partial implementation)
 */
export function planResume(
  resume: { phase?: string | null; merged: boolean; epicBaseSha?: string | null } | null,
  currentEpicSha: string | null,
  hasBlueprintOutput = false,
  /** Durable base SHA the reusable blueprint was authored against (leaf_blueprint).
   *  Used when the run checkpoint was cleared by a terminal outcome but the blueprint
   *  itself is still valid. */
  blueprintBaseSha: string | null = null,
): ResumePlan {
  if (!resume) {
    // D1: a terminal outcome cleared the run checkpoint, but a durably-recorded
    // blueprint authored against the CURRENT tip is still reusable. The base guard
    // below is identical to the resume-row path — never weaker.
    if (hasBlueprintOutput && blueprintBaseSha && currentEpicSha) {
      if (blueprintBaseSha === currentEpicSha)
        return { mode: 'reattach-blueprint', reason: 'blueprint-reusable-no-resume-row' };
      return { mode: 'fresh', reason: 'epic-base-moved' };
    }
    // D3: null currentEpicSha is silently fatal — we can't verify the world state.
    if (!currentEpicSha) return { mode: 'fresh', reason: 'no-epic-base' };
    return { mode: 'fresh', reason: 'no-resume-state' };
  }
  if (resume.merged) return { mode: 'skip-to-gate', reason: 'work-merged' };
  // Paused/killed at-or-before the blueprint node. If a COMPLETED blueprint was
  // durably recorded (the leaf rate-paused after authoring it), reuse it instead of
  // re-burning the ~opus blueprint node — the 1.8M-token re-burn loop. Only treat as
  // genuinely fresh when no usable blueprint output exists.
  if ((!resume.phase || resume.phase === 'blueprint') && !hasBlueprintOutput)
    return { mode: 'fresh', reason: 'killed-before-blueprint' };
  // Fall back to the durable blueprint base when the row lost its sha (COALESCE gap).
  const base = resume.epicBaseSha ?? blueprintBaseSha;
  if (!base || !currentEpicSha) return { mode: 'fresh', reason: 'no-epic-base' };
  if (base !== currentEpicSha) return { mode: 'fresh', reason: 'epic-base-moved' };
  return { mode: 'reattach-blueprint', reason: 'blueprint-reusable' };
}

/** A node that never STARTED: non-zero/negative exit, ZERO tokens in and out, and it
 *  died fast. Not a work failure — the model never ran. Rate-limited results are
 *  excluded (they have their own pause path). Require minimum ~100ms duration so we
 *  don't match test mocks; real CLI failures take at least that long to fork+exit. */
export function isNodeStartFailure(res: NodeResult): boolean {
  if (res.rateLimited || res.ok) return false;
  const u = res.usage;
  const zeroTokens = ((u?.inputTokens ?? 0) + (u?.outputTokens ?? 0) + (u?.cacheReadTokens ?? 0)) === 0;
  const dur = res.durationMs ?? 0;
  return zeroTokens && dur >= 100 && dur < 5_000;
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
  deps.assertAuth();
  if (anyGrokNodeConfigured(project)) (deps.assertGrokAuth ?? assertGrokAuth)();
  if (anyXaiApiNodeConfigured(project)) (deps.assertXaiApiAuth ?? assertXaiApiAuth)();

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
    // TERMINAL outcome (accepted/blocked/rejected/split).
    if (r.outcome !== 'pending' && r.outcome !== 'paused') {
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
  const state = { attempt: 0, nodesSpent: deps.startNodesSpent ?? 0 };
  // Which execution path the last attempt took — recorded on the terminal record so a
  // run's shape (and which path a failure came from) is legible without re-deriving.
  let pathTaken: 'floor' | 'waves' | 'review' | null = null;
  // C2: accumulate recorded commands from each node for evidence gating in review
  const recordedCommands: RecordedCommand[] = [];

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

  // Per-(project, node-kind) model + effort overrides, resolved once per run.
  // model  : per-kind override → NODE_PROFILE default.
  // effort : per-kind override → per-project blanket (getProjectEffort) →
  //          MERMAID_NODE_EFFORT env → per-kind NODE_PROFILE default.
  const nodeOverrides = listNodeProfileOverrides(project);
  const projectEffort = getProjectEffort(project);
  const nodeModel = (kind: LeafNodeKind, allowedTools = NODE_PROFILE[kind].allowedTools): string => {
    const provider = resolveNodeProvider(project, kind, allowedTools);
    return resolveNodeModel(project, kind, provider, NODE_PROFILE[kind].model);
  };
  const nodeEffort = (kind: LeafNodeKind): EffortLevel =>
    nodeOverrides[kind]?.effort ?? projectEffort ?? ENV_NODE_EFFORT ?? NODE_PROFILE[kind].effort;

  // NODE_BUDGET (20) is the runaway ceiling sized for the FLOOR (≤6 nodes/2 attempts). The
  // WAVES path legitimately spends ~tasks + files×~3 nodes (research per task, then
  // implement/verify/fix per file) — a 6-file leaf needs ~22, which the floor ceiling
  // false-kills mid-wave (the L4 node-budget-exhausted). Raise the ceiling size-aware for
  // waves (computed from the manifest below), capped so a true runaway is still bounded.
  // A test-supplied nodeBudget is honored verbatim (so budget-ceiling tests stay
  // deterministic). `let` so the waves branch can lift it once the manifest is known.
  let budget = deps.nodeBudget ?? NODE_BUDGET;
  /** TRUE while still within the master node budget. */
  const checkBudget = (): boolean => state.nodesSpent <= budget;

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
      recordedModel = nodeModel(kind);
    }
    // NOTE (bug 0f1df3d2): do NOT clear the inflight row here. It is set per-node
    // (above) so nodeKind stays fresh, but the row must SPAN the whole run — including
    // the between-nodes window — so the daemon's orphan-reclaim guard (isLeafInflightLive)
    // never reclaims a live leaf mid-run. The single clear lives in finishWith.
    const res: NodeResult = await invoker.invoke(effSpec);
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
          pathTaken,
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
    try { await deps.releaseClaim?.(project, leaf.id); } catch { /* best-effort */ }
    deps.escalate({ project, session: sessionKey, kind: 'blocker', todoId: leaf.id,
      questionText: `Leaf-executor could not START the ${kind} node for "${leaf.title ?? leaf.id}" — ${reason} Check the node-profile row for this project/kind: the model does not belong to the provider.` });
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

  const buildSpec = (
    kind: LeafNodeKind,
    cwd: string,
    blueprintText?: string,
    reviewFindings?: string,
  ): NodeSpec => ({
    prompt: buildNodePrompt(kind, leaf, blueprintText, reviewFindings),
    model: nodeModel(kind),
    effort: nodeEffort(kind),
    allowedTools: NODE_PROFILE[kind].allowedTools,
    // Strip the project's MCP server (.mcp.json) from any node that can't call an mcp__
    // tool — build nodes use only built-ins, so the ~200-tool surface is dead context.
    strictMcpConfig: !NODE_PROFILE[kind].allowedTools.includes('mcp__'),
    cwd,
    leafId: leaf.id,
    epicId,
    project, // E1: recorded in the leaf-subprocess registry for per-project brake
    permissionMode: 'bypassPermissions',
    transcriptPath: leafTranscriptPath(project, leaf.id),
    transcriptLabel: kind,
  });

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
    cwd,
    leafId: leaf.id,
    epicId,
    project, // E1: recorded in the leaf-subprocess registry for per-project brake
    permissionMode: 'bypassPermissions',
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
  const runReviewPipeline = async (): Promise<LeafRunResult> => {
    state.attempt = 1; // single pass (no fresh-worktree retry loop)
    pathTaken = 'review';
    const wt = await deps.wm.ensure(sessionKey, { baseBranch: epicBranch, fresh: true });
    const cwd = wt.path;
    // The union change-set base: the epic branch was cut off master, so master..HEAD is the
    // epic's accumulated work. The node is told to fall back if the ref doesn't resolve.
    const baseRef = 'master';
    // The review node needs add_session_todo (file gap todos) on top of the read-only set;
    // NO Write (the executor commits the report — a node Write resolves to the project root).
    const reviewTools = `${NODE_PROFILE.review.allowedTools} mcp__mermaid__add_session_todo`;
    const buildReviewSpec = (): NodeSpec => ({
      prompt: buildReviewPrompt(leaf, baseRef),
      model: nodeModel('review', reviewTools),
      effort: nodeEffort('review'),
      allowedTools: reviewTools,
      cwd,
      leafId: leaf.id,
      epicId,
      permissionMode: 'bypassPermissions',
      transcriptPath: leafTranscriptPath(project, leaf.id),
      transcriptLabel: 'review',
    });

    let rev = await runNode('review', buildReviewSpec());
    if (rev.startFailure) return parkNodeStartFailure('review', rev);
    if (rev.rateLimited) return pausedResult('review', rev);
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    if (!rev.ok) {
      rev = await runNode('review', buildReviewSpec());
      if (rev.rateLimited) return pausedResult('review', rev);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    }
    if (!rev.ok) return parkBlocked('review-node-failed');

    // CONTENT GATE (Grok #3): a committed report would trivially pass the work-committed
    // re-verify, so re-arm the hallucination guard HERE — the report must be non-empty AND
    // end with a parseable VERDICT line, else the reviewer did no real work → park blocked.
    const reportMd = (rev.text ?? '').trim();
    if (!reportMd) return parkBlocked('review-report-empty');
    const parsedVerdict = parseVerdict(reportMd);
    if (parsedVerdict === 'error') return parkBlocked('review-report-no-verdict'); // no parseable VERDICT line
    const verdict = parsedVerdict; // pass|fail — informational; BOTH accept.

    // L5: the EXECUTOR persists the report into the worktree (the node only emitted it) — a
    // node's new-file Write resolves to the project root, not the worktree, so it would never
    // reach mergeToEpic.
    try {
      await deps.writeArtifact?.(cwd, reviewReportPath(leaf), reportMd);
    } catch (e) {
      return parkBlocked(
        `review-report-write-failed: ${e instanceof Error ? e.message : String(e)}`,
        verdict,
      );
    }
    return finalizeReportLeaf(verdict, `review: ${leaf.title ?? leaf.id}`);
  };

  const runVerifyPipeline = async (): Promise<LeafRunResult> => {
    state.attempt = 1; // single pass (no fresh-worktree retry loop) — telemetry shows attempts=1
    const cfg = (deps.resolveVerifyGate ?? resolveVerifyGate)(leaf); // L3: pluggable {verb, command}
    const wt = await deps.wm.ensure(sessionKey, { baseBranch: epicBranch, fresh: true });
    const cwd = wt.path;

    // 1. PLAN — author the AssemblyBuildPlan. One in-place retry on a failed node (mirrors
    //    the code path's blueprint retry) before parking.
    let plan = await runNode('driveplan', buildVerifySpec('driveplan', cwd, cfg.verb));
    if (plan.rateLimited) return pausedResult('driveplan', plan);
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    if (!plan.ok) {
      plan = await runNode('driveplan', buildVerifySpec('driveplan', cwd, cfg.verb));
      if (plan.rateLimited) return pausedResult('driveplan', plan);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    }
    if (!plan.ok) return parkBlocked('verify-plan-node-failed');

    // Read the plan artifact back (deterministic source); fall back to the node's final text.
    const planFromFile = await deps.readArtifact?.(cwd, verifyPlanPath(leaf)).catch(() => undefined);
    const planText = planFromFile && planFromFile.trim() ? planFromFile : plan.text;
    if (!planText || !planText.trim()) return parkBlocked('verify-plan-empty');

    // 2. EXECUTE — node constrained to the resolved verb; captures its raw result. The verb
    //    call is a single network-heavy MCP round-trip, so give ONE in-place retry on a
    //    transient node failure (e.g. the "Connection closed while thinking" API drop seen in
    //    the first live T14 run) before parking — mirrors the blueprint-node retry. The verb is
    //    deterministic/idempotent, so re-calling is safe.
    let exec = await runNode('driveexec', buildVerifySpec('driveexec', cwd, cfg.verb, planText));
    if (exec.rateLimited) return pausedResult('driveexec', exec);
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    if (!exec.ok) {
      exec = await runNode('driveexec', buildVerifySpec('driveexec', cwd, cfg.verb, planText));
      if (exec.rateLimited) return pausedResult('driveexec', exec);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    }
    if (!exec.ok) return parkBlocked('verify-execute-node-failed');

    // 3. GATE — parse the verb's TRUE verdicts from the result artifact (not the prose).
    const resultFromFile = await deps.readArtifact?.(cwd, verifyResultPath(leaf)).catch(() => undefined);
    const resultText = resultFromFile && resultFromFile.trim() ? resultFromFile : exec.text;
    const gate = parseVerifyGate(resultText);
    // INFRA error (verb crashed / no parseable verdict) is NOT a finding → park blocked.
    if (gate.status === 'error') return parkBlocked(gate.reasons[0] ?? 'verify-gate-error', 'fail');
    // 'pass' or 'fail' (real domain findings) both proceed; the command gate composes below.
    const findings = [...gate.reasons];

    // 3b. COMMAND GATE (L3, optional) — run the config's shell gate in the worktree, composed
    //     AFTER the verb gate. A spawn failure (ran:false) is INFRA → park blocked; a non-zero
    //     exit (ran:true, ok:false) is a FINDING folded into the report alongside the verdicts.
    if (cfg.command) {
      const cmd = await deps.runCommandGate?.(cwd, cfg.command);
      if (!cmd) return parkBlocked(`verify-command-gate-unwired: ${cfg.command}`, 'fail');
      if (!cmd.ran) return parkBlocked(`verify-command-gate-failed-to-run: ${cfg.command}`, 'fail');
      if (!cmd.ok) findings.push(`command gate failed: \`${cfg.command}\`\n${cmd.output.slice(0, 2000)}`);
    }

    // 4. REPORT — write + commit the findings .md, file one session-todo per finding.
    const report = await runNode(
      'report',
      buildVerifySpec('report', cwd, cfg.verb, planText, findings.join('\n')),
    );
    if (report.rateLimited) return pausedResult('report', report);
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    if (!report.ok) return parkBlocked('verify-report-node-failed');

    // L5: the EXECUTOR persists the report into the worktree (the node only emitted it) — a
    // node's new-file Write resolves to the project root, not the worktree, so it would never
    // reach mergeToEpic. Write it at the worktree path; an empty report is an executor failure.
    const reportMd = (report.text ?? '').trim();
    if (!reportMd) return parkBlocked('verify-report-empty');
    try {
      await deps.writeArtifact?.(cwd, verifyReportPath(leaf), reportMd);
    } catch (e) {
      return parkBlocked(`verify-report-write-failed: ${e instanceof Error ? e.message : String(e)}`, 'fail');
    }

    // Overall verdict: clean ONLY if BOTH the verb gate passed AND no command-gate finding.
    // COMMIT-SHAPED DELIVERABLE: the shared report tail merges the committed report onto the
    // epic branch BEFORE proposing acceptance, exactly like the code path, so the gate's
    // work-committed re-verify sees committed work. A failing DOMAIN gate is captured in the
    // report + filed findings, not a rejected leaf.
    const gateVerdict: 'pass' | 'fail' = findings.length === 0 ? 'pass' : 'fail';
    return finalizeReportLeaf(gateVerdict, `verify: ${leaf.title ?? leaf.id}`);
  };

  // --- G2 EPIC BASE GATE ---------------------------------------------------------
  // A red base is the most important fact on a branch: EVERY leaf built on it inherits
  // its brokenness. Check it BEFORE the execution-mode dispatch so a red base starts
  // ZERO leaves of any shape and spends ZERO nodes (nodesSpent stays 0 in the terminal
  // record). Cached once per epic (deps.ensureBaseGreen) — this call is cheap on every
  // leaf after the first.
  const base = await deps.ensureBaseGreen?.();
  if (base && base.status !== 'pass') {
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
    return await runVerifyPipeline();
  }
  if (leafExecutionMode(leaf) === 'review') {
    return await runReviewPipeline();
  }

  // RESUME: SKIP-TO-GATE (slice 2). A prior (killed) run already committed this
  // leaf's work onto the epic branch but died before the acceptance gate finished.
  // Re-running the whole leaf would be pure waste — just run the gate, which
  // re-verifies the already-committed work. Safe regardless of further epic advance.
  if (deps.resumePlan?.mode === 'skip-to-gate') {
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
  for (state.attempt = 0; state.attempt < ATTEMPT_CAP; ) {
    state.attempt += 1; // 1-based count for telemetry/escalation
    const isLastAttempt = state.attempt >= ATTEMPT_CAP;

    const wt = await deps.wm.ensure(sessionKey, { baseBranch: epicBranch, fresh: true });
    const cwd = wt.path;

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
    const reattach = state.attempt === 1 && deps.resumePlan?.mode === 'reattach-blueprint';
    const inRunCarry = state.attempt > 1 && carriedBlueprint != null && carriedBlueprint.trim().length > 0;
    const restored = reattach ? (deps.restoreBlueprint?.(leaf.id) ?? null) : (inRunCarry ? carriedBlueprint : null);
    if ((reattach || inRunCarry) && restored && restored.trim()) {
      await deps.writeArtifact?.(cwd, blueprintPath(leaf), restored);
      // Synthetic OK result — no node spent (the whole point); text feeds the size
      // gate + implement just like a fresh blueprint node's final message.
      bp = { ok: true, exitCode: 0, stdout: restored, durationMs: 0, rateLimited: false, authMode: 'subscription', text: restored };
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

    // G8: Record the blueprint base SHA so a reusable blueprint survives when the run
    // checkpoint is cleared by a terminal outcome. Guarded to NOT rewrite on synthetic
    // reattach/in-run-carry results (those have durationMs === 0).
    if (!reattach && !inRunCarry) {
      deps.persistBlueprintBase?.({ project, leafId: leaf.id, epicBaseSha: deps.epicBaseSha });
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
    let citability = validateCriteriaCitability(blueprintBody, declaredForCriteria);
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
        citability = validateCriteriaCitability(reBody, redeclaredForCriteria);
      }
      if (citability.status === 'uncitable') {
        try { await deps.bumpRetry?.(project, leaf.id); } catch { /* telemetry — never break the park */ }
        return parkBlocked(`blueprint-uncitable-criterion: ${citability.reasons.join('; ')}`);
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
      budget = Math.max(budget, raisedNodeBudget(deps.nodeBudget ?? NODE_BUDGET));
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

    // G12: Snapshot untracked files BEFORE the first writing node so we can later
    // distinguish files the leaf created (new) from pre-existing junk.
    try { untrackedAtStart = listUntrackedPaths(cwd); } catch { /* best-effort */ }

    // G12: Derive the declared scope from the manifest + the split-child description.
    const declaredFiles = [...new Set([
      ...(manifest ? [...manifest.filesToCreate, ...manifest.filesToEdit, ...manifest.tasks.flatMap(t => t.files)] : []),
      ...parseDeclaredScope(leaf.description),
    ])];

    // WAVES RETIRED (2026-07-08): every claimed leaf runs LINEAR (FLOOR). A leaf too big
    // for one linear run (> SPLIT_CEILING = FILE_THRESHOLD enumerated files) was already
    // auto-split PRE-FLIGHT above, so anything reaching here is within the linear band —
    // the proven-cheap+reliable path (measured ~5 nodes / ~90% pass vs the old fan-out's
    // ~27 nodes / ~63%). The rare non-enumerable-big or many-task leaf that dodged the
    // split also runs linear (fail-safe). (The old runWaves/buildWavePrompt/wavesBudget/
    // shouldUseFloor machinery was deleted in the WAVES dead-code sweep.)
    pathTaken = 'floor';
    // IMPLEMENT (byte-identical to the prior FLOOR path):
    const impl = await runNode('implement', buildSpec('implement', cwd, blueprintBody));
    if (impl.startFailure) return parkNodeStartFailure('implement', impl);
    if (impl.rateLimited) return pausedResult('implement', impl);
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');

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
        return parkBlocked(`gate-could-not-run: ${mech.command ?? 'gate'} — ${lastLines(mech.output, 5)}`);
      }

      // A mechanically-red tree NEVER spends a review node. The LLM's opinion on broken
      // code is worth exactly nothing, and it costs an opus call to obtain.
      let llm: LeafReviewVerdict | null = null;
      let findings: string;
      if (mech.status === 'fail') {
        findings = gateFindingsText(mech);
      } else {
        const review = await runNode('review', buildSpec('review', cwd, blueprintBody));
        if (review.startFailure) return parkNodeStartFailure('review', review);
        if (review.rateLimited) return pausedResult('review', review);
        llm = parseVerdict(review.text);
        // INFRA, not a finding (80bacbc4): the reviewer emitted nothing parseable. Feeding ''
        // back to implement is a livelock (empty findings also defeat the isRepeat stuck-
        // detector below, so it runs to node-budget exhaustion). Park, and RECORD it —
        // retryCount stayed 0 before, so the graph showed no incident at all.
        if (llm === 'error') {
          try { await deps.bumpRetry?.(project, leaf.id); } catch { /* telemetry — never break the park */ }
          return parkBlocked('review-vacuous');
        }
        // --- G3 GROUNDING GATE -------------------------------------------------
        // A PASS is the ONLY path from an LLM string to an accept, so it is the only one
        // that must prove it looked. Structure + citations are MECHANICAL; the semantics
        // of each criterion remain the LLM's. A FAIL is deliberately exempt: it never
        // accepts, and forcing structure on it would turn a real finding into a park.
        if (llm === 'pass') {
          const cs = (await deps.changeSet?.(sessionKey)) ?? null;
          const grounding = validateReviewGrounding(review.text ?? '', cs);
          if (grounding.status === 'vacuous') {
            try { await deps.bumpRetry?.(project, leaf.id); } catch { /* telemetry — never break the park */ }
            return parkBlocked(`review-vacuous: ${grounding.reasons.join('; ')}`);
          }
          // C2: evidence gate — the claim must be a fact the executor holds.
          const evidence = evaluateCommandEvidence({
            commands: recordedCommands,
            claims: parseVerificationClaims(grounding.criteria, review.text ?? ''),
            worktreeRoot: cwd,
          });
          if (evidence.reject) {
            try { await deps.bumpRetry?.(project, leaf.id); } catch { /* telemetry — never break the park */ }
            return parkBlocked(`command-evidence: ${evidence.reasons.join('; ')}`);
          }
          unbackedNote = evidence.unbackedClaims.length
            ? `unbacked-claim (non-fatal): ${evidence.reasons.join('; ')}`
            : undefined;
        }
        findings = (review.text ?? '').trim();
      }

      // final = mechanical AND llm. Never "whichever spoke last": a review's bare
      // `VERDICT: PASS` composes as composeVerdict('fail','pass') === 'fail' against a
      // red gate — there is no code path from an LLM string to an accept when the
      // gate is red (the 84048309 shape).
      // mech.status/llm are statically 'error'-typed but both 'error' arms above already
      // returned, so at runtime composeVerdict can only yield 'pass' | 'fail' here.
      reviewVerdict = composeVerdict(mech.status, llm) as 'pass' | 'fail';
      // A PASS means the work is COMPLETE — accept it regardless of budget. The budget is a
      // runaway guard on doing MORE work, not a reason to DISCARD a finished, passing leaf.
      // (L6: a PASS landed on the node that tripped the budget and was wrongly thrown away
      // as node-budget-exhausted, losing complete+compiling work.)
      if (reviewVerdict === 'pass') break;
      // FAILED → we'd spend MORE nodes remediating. NOW gate on the budget.
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
      const isRepeat = findings !== '' && findings === prevFindings;
      if (reuses >= REVISE_REUSE_CAP || isRepeat) break; // exhausted / stuck → fresh attempt
      reuses += 1;
      prevFindings = findings;
      const fix = await runNode('implement', buildSpec('implement', cwd, blueprintBody, findings));
      if (fix.rateLimited) return pausedResult('implement', fix);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
      // loop → re-review the surgically-fixed tree
    }

    if (reviewVerdict === 'pass') {
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
        reason: reason ?? unbackedNote,
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
    if (isLastAttempt) return parkBlocked('attempt-cap-exhausted', reviewVerdict);
  }

  // Unreachable in practice (the loop returns), but keeps the type total.
  return parkBlocked('attempt-cap-exhausted');
  } catch (e) {
    if (e instanceof LeafAborted) {
      recordOutcome('aborted', null, { reason: e.abortReason ?? undefined });
      return finishWith({ outcome: 'aborted', attempts: state.attempt, nodesSpent: state.nodesSpent, reason: e.abortReason ?? undefined });
    }
    throw e;
  }
}

/** Per-attempt blueprint document name. Mint and prefix-scan share this so they can't drift. */
export function blueprintAttemptName(leafId: string, attempt: number): string {
  return `Leaf blueprint — ${leafId.slice(0, 8)} attempt ${attempt}`;
}
/** The stable prefix of every attempt name for a leaf (all attempts, any N). */
export function blueprintAttemptPrefix(leafId: string): string {
  return `Leaf blueprint — ${leafId.slice(0, 8)} attempt `;
}

/**
 * Mark every PRIOR attempt blueprint for `leafId` as deprecated, leaving only `liveId`.
 * Prefix-scans the documents (NOT link.blueprintId chaining) so it also catches ORPHANS —
 * attempts from interrupted runs that died before the todo link was updated, which is why
 * all attempts otherwise sit at equal visual weight. Exported for direct testing.
 */
export async function deprecatePriorAttempts(
  dm: import('./document-manager').DocumentManager,
  sessionDir: string,
  leafId: string,
  liveId: string,
): Promise<void> {
  const { MetadataManager } = await import('./metadata-manager');
  const mm = new MetadataManager(sessionDir);
  await mm.initialize();
  const prefix = blueprintAttemptPrefix(leafId);
  for (const d of await dm.listDocuments()) {
    if (d.id !== liveId && d.name.startsWith(prefix)) {
      await mm.updateItem(d.id, { deprecated: true });
    }
  }
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
  // Materialise the epic accumulation branch so the off-tip base exists.
  const epic = await wm.ensureEpic(epicId, targetProject);
  const epicBranch = epic?.branch ?? 'master';
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
      const fi = await wm.forwardIntegrateEpic(epicId, 'master');
      if (fi.conflict) {
        try {
          createEscalation({
            project,
            session: leafSessionKey(leaf),
            todoId: leaf.id,
            kind: 'assumption-invalidated',
            questionText:
              `Forward-integration conflict: could not merge master into epic branch ${epicBranch} before building ` +
              `"${leaf.title ?? leaf.id}" (conflicts: ${(fi.conflictedPaths ?? []).join(', ') || 'unknown'}). ` +
              `The epic branch is behind trunk and auto-merge failed — the leaf will build on the current (stale) ` +
              `epic tip. Resolve by merging master into ${epicBranch} by hand, then re-run.`,
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
  const hasBlueprintOutput = !!getLatestNodeOutput(leaf.id, 'blueprint')?.trim();
  const bpRow = getLeafBlueprint(leaf.id);
  const resumePlan = planResume(existingResume, epicBaseSha, hasBlueprintOutput, bpRow?.epicBaseSha ?? null);
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
  if (resumePlan.mode === 'fresh' && resumePlan.reason === 'epic-base-moved') clearLeafBlueprint(leaf.id);
  // G2 mechanical gate, G4 abstention: classify ONCE per deps construction. `declared` runs the
  // gate; `absent` abstains LOUDLY; `misconfigured` is INFRA — never a silent pass.
  const manifestSource = loadManifestSource(targetProject);
  const gateDecl = resolveGateDeclaration(manifestSource);
  const gateCfg = gateDecl.kind === 'declared' ? gateDecl.cfg : null;
  // The FLOOR review loop calls runGate once per pass (implement→review→fix→review), but the
  // abstention is a property of the LEAF, not of the pass. Latch it so the ledger carries one
  // 'gate-abstain' row per leaf run — matching warnGateAbstention's own once-per-epic dedupe.
  let recordedGateAbstain = false;
  return {
    invoker: ClaudeNodeInvoker,
    grokInvoker: GrokNodeInvoker,
    xaiInvoker: XaiApiNodeInvoker,
    wm,
    epicId,
    epicBranch,
    epicBaseSha,
    resumePlan,
    startNodesSpent: effectiveStart,
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
    changeSet: (sessionKey) => wm.changeSet(sessionKey, epicBranch),
    splitInto: async (lf, files) => { await splitLeafInto(project, lf, files); },
    escalate: createEscalation,
    proposeSplit,
    awaitSplitDecision,
    resolveProposal: resolveEscalation,
    recordNode,
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
    restoreBlueprint: (leafId) => getLatestNodeOutput(leafId, 'blueprint'),
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
      try {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        if (r.error) return { ran: false, ok: false, output: String(r.error.message ?? r.error) };
        return { ran: true, ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
      } catch (e) {
        return { ran: false, ok: false, output: e instanceof Error ? e.message : String(e) };
      }
    },
    resolveVerifyGate,
    // G2 mechanical gate at leaf HEAD. Scoped to this leaf's own change-set (against the
    // epic branch base) so the per-file test command only runs specs this leaf touched.
    runGate: async (cwd) => {
      const early = gateResultForDeclaration(gateDecl);
      if (early) return early; // misconfigured → mech.status==='error' → parkBlocked+escalate
      if (gateDecl.kind === 'absent') {
        warnGateAbstention(project, epicId, targetProject, gateDecl);
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
      return runLeafGate(cwd, gateCfg, changeSet, defaultGateSpawn);
    },
    // G2 once-per-epic base gate, cached in the epic_base_gate ledger table keyed by
    // epicId ALONE (never the moving tip) so it runs exactly once per epic, not once
    // per leaf. `fresh:true` only on the call that actually executed the commands.
    ensureBaseGreen: async () => {
      const early = gateResultForDeclaration(gateDecl);
      if (early) return { ...early, fresh: true }; // escalate once; never cache a config error as a base fact
      if (!gateCfg) return null; // absent → abstain (unchanged)
      const cached = getEpicBaseGate(epicId, epicBaseSha);
      if (cached) {
        return {
          status: cached.status,
          command: cached.command ?? undefined,
          output: cached.output ?? '',
          reasons: [],
          declared: true,
          fresh: false,
        };
      }
      // ensureEpic was already called above in this same factory — idempotent, no new
      // worktree churn. Run at the epic worktree (inside the repo ⇒ node_modules
      // resolves upward), AFTER forwardIntegrateEpic so we gate the base a leaf will
      // actually fork from.
      const wt = await wm.ensureEpic(epicId, targetProject);
      if (!wt) return null; // non-git fallback ⇒ no base gate
      const r = await runBaseGate(wt.path, gateCfg, defaultGateSpawn);
      if (isCacheableBaseGateStatus(r.status)) {
        recordEpicBaseGate({
          epicId,
          project,
          baseSha: epicBaseSha,
          status: r.status,
          command: r.command ?? null,
          output: r.output || null,
        });
      }
      return { ...r, fresh: true };
    },
    // Durable per-attempt blueprint persistence (best-effort; throws are swallowed at
    // the call site). Writes a collab document scoped to a fixed `leaf-blueprints`
    // session under the TRACKING `project`, then points the leaf todo's
    // `link.blueprintId` at the LATEST attempt's doc (prior attempts persist as their
    // own docs, discoverable but not the primary link). Preserves any existing taskId.
    persistBlueprint: async ({ project: trackingProject, leaf: lf, attempt, blueprintMd }) => {
      const { sessionRegistry } = await import('./session-registry');
      const { DocumentManager } = await import('./document-manager');
      const { updateTodo } = await import('./todo-store');
      const BLUEPRINT_SESSION = 'leaf-blueprints';
      await sessionRegistry.registerIfAbsent(trackingProject, BLUEPRINT_SESSION);
      const dir = sessionRegistry.resolvePath(trackingProject, BLUEPRINT_SESSION, 'documents');
      const dm = new DocumentManager(dir);
      await dm.initialize();
      const name = blueprintAttemptName(lf.id, attempt);
      // createDocument throws if the sanitized id already exists (e.g. a resumed attempt);
      // fall back to saving over the existing doc so re-runs are idempotent.
      const sanitizedId = name.replace(/[^a-zA-Z0-9-_]/g, '-');
      let id: string;
      try {
        id = await dm.createDocument(name, blueprintMd);
      } catch {
        await dm.saveDocument(sanitizedId, blueprintMd);
        id = sanitizedId;
      }
      await updateTodo(trackingProject, lf.id, {
        link: { blueprintId: id, ...(lf.link?.taskId ? { taskId: lf.link.taskId } : {}) },
      });
      // Auto-deprecate every PRIOR attempt blueprint for this leaf so only the live
      // one shows by default. Best-effort: superseding is cosmetic, never fail a build.
      const sessionDir = sessionRegistry.resolvePath(trackingProject, BLUEPRINT_SESSION, '.');
      await deprecatePriorAttempts(dm, sessionDir, lf.id, id).catch(() => {});
      return id;
    },
  };
}
