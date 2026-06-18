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
import type { Todo } from './todo-store';
import { splitLeafInto } from './todo-store';
import type { NodeInvoker, NodeResult, NodeSpec, AuthMode } from '../agent/node-invoker';
import type { EffortLevel } from '../agent/contracts';
import { getProjectEffort, listNodeProfileOverrides } from './orchestrator-config';
import type { WorktreeManager } from '../agent/worktree-manager';
import { ClaudeNodeInvoker, assertSubscriptionAuth } from '../agent/node-invoker';
import { getWorktreeManager, resolveEpicId, makeCoordinatorDeps } from './coordinator-live';
import { handleWorkerComplete } from './coordinator-daemon';
import { createEscalation } from './supervisor-store';
import { recordNode, setLeafInflight, clearLeafInflight } from './worker-ledger';
import { scopeFailureToChangeSet, isInChangeSet } from './gate-runner';

/** Node kinds. The floor chains blueprint→implement→review (unchanged). P5 adds the
 *  wave kinds (research/wimplement/verify/fix); `'implement'` stays RESERVED for the
 *  floor so floor ledger rows are byte-identical. */
export type LeafNodeKind =
  | 'blueprint' | 'implement' | 'review' // floor (unchanged)
  | 'research' | 'wimplement' | 'verify' | 'fix' // waves (P5)
  | 'driveplan' | 'driveexec' | 'report'; // verify pipeline (epic f5c7fc46)

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
}

/** Dependency seam — defaults wire the real implementations; tests inject mocks. */
export interface LeafExecutorDeps {
  /** Node invoker. Default `ClaudeNodeInvoker` (real `claude -p`). */
  invoker: NodeInvoker;
  /** Worktree manager for the TARGET repo. */
  wm: WorktreeManager;
  /** The epic id this leaf rolls up to (per-epic accumulation branch). */
  epicId: string;
  /** The epic's accumulation branch (worktrees are cut fresh off its tip). */
  epicBranch: string;
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
  ) => Promise<unknown>;
  /** Raise an escalation card (blocker). */
  escalate: (input: {
    project: string;
    session: string;
    kind: string;
    todoId?: string | null;
    questionText: string;
  }) => void;
  /** Append a best-effort node-ledger row. */
  recordNode: typeof recordNode;
  /** LIVE in-flight signal (optional): mark/clear the leaf as running a node so separate
   *  processes (UI, MCP, daemon_status) can see "on node X, Ns elapsed". Best-effort; the
   *  floor/tests run fine unwired. */
  setInflight?: (e: { project: string; leafId: string; epicId?: string | null; nodeKind?: string | null; model?: string | null; attempt?: number | null }) => void;
  clearInflight?: (leafId: string) => void;
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
  /** Auto-split seam (worker-decomposition): decompose a too-big leaf into one child
   *  leaf per file UNDER it — the leaf becomes a non-executable dependency-grouping
   *  container (sweepEpicRollups closes it when its children settle; it owns no branch
   *  and triggers no merge). Default → `splitLeafInto` in todo-store (createTodo per file
   *  + release this leaf's claim). Optional `?.`: unwired (tests / floor) ⇒ never splits. */
  splitInto?: (leaf: Todo, files: string[]) => Promise<void>;
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
}

export interface LeafRunResult {
  // 'pending' is a FIRST-CLASS outcome (no longer collapsed into 'rejected'): the
  // review PASSed and the work merged, but the completion gate's work-committed
  // re-verify deferred. Distinct from 'rejected' (gate/review actually failed).
  // 'split' (worker-decomposition): the leaf was too big to build in one run, so it was
  // decomposed PRE-FLIGHT into one child leaf per file and became a non-executable
  // dependency-grouping container. No completion, no merge — sweepEpicRollups closes it
  // when its children settle; the enclosing epic's LAND leaf stays the merge authority.
  // The coordinator treats it as "this dispatch produced no acceptance" (returns false);
  // the container claim-guard then keeps the parent from being re-claimed.
  outcome: 'accepted' | 'rejected' | 'pending' | 'blocked' | 'paused' | 'split';
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
/** Hard cap on the size-aware WAVES budget — a true runaway is still bounded. */
export const WAVES_BUDGET_MAX = 45;
/** Size-aware node budget for the waves path: blueprint(1) + research(per task) +
 *  implement/verify/fix per file (~4 — wimplement + verify + a fix + the re-verify the
 *  per-file fix loop adds) + gate/review margin(6), capped. */
export function wavesBudget(taskCount: number, fileCount: number): number {
  return Math.min(WAVES_BUDGET_MAX, 1 + taskCount + fileCount * 4 + 6);
}
/** P6 surgical reuse: max in-place re-implement passes per attempt on a missing-logic
 *  review FAIL (a NEW finding) before discarding the worktree for a fresh attempt. */
export const REVISE_REUSE_CAP = 1;

/** P5 size-gate thresholds (tunable). A leaf is FLOOR-eligible iff it touches
 *  `<= FILE_THRESHOLD` files AND `<= TASK_THRESHOLD` tasks AND has no
 *  non-enumerable fan-out. Over any of these ⇒ WAVES. */
export const FILE_THRESHOLD = 4;
export const TASK_THRESHOLD = 6;
/** Auto-split ceiling (worker-decomposition): a leaf whose ENUMERATED file set exceeds
 *  this is decomposed PRE-FLIGHT into one child leaf per file rather than run as one
 *  (over-large) WAVES leaf that tends to exhaust its node budget. Above FILE_THRESHOLD
 *  (=WAVES) and well above it — ≤4 FLOOR, 5..SPLIT_CEILING WAVES, >SPLIT_CEILING split.
 *  A non-enumerable manifest can't be partitioned, so it never auto-splits (→ WAVES). */
export const SPLIT_CEILING = 12;

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
};

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
};

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
        '  "tasks": [ { "id": "<slug>", "files": ["<path>"], "description": "<one line>" } ] }',
        '```',
        'estimatedFiles = total distinct files created+edited. estimatedTasks = number of',
        'independent units of work. nonEnumerableFanout = true ONLY if there are sites you',
        'CANNOT statically enumerate (dynamic dispatch, string-keyed/reflective call sites).',
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
        'If you spot-check compilation, run tsc ONLY from the repo root via `npx tsc --noEmit -p tsconfig.json` (the PROJECT config) — NEVER `tsc <file>` on a bare path, which drops the project lib/options and yields false errors.',
      ].filter(Boolean).join('\n');
    case 'review':
      return [
        'You are the REVIEW node, READ-ONLY (Read/Grep/Glob and Bash for inspection ONLY; no edits).',
        blueprintText
          ? `Compare the working tree against THIS leaf's blueprint, inlined below (do NOT read any other blueprint file — ignore strays in shared dirs):\n\n=== BLUEPRINT (${leaf.id}) START ===\n${blueprintText}\n=== BLUEPRINT END ===`
          : `Compare the working tree against the blueprint at \`${bp}\` (ONLY that exact file).`,
        'Decide if the work is complete and correct (it compiles, satisfies the blueprint, no obvious bugs).',
        'To check compilation, run tsc ONLY from the repo root via `npx tsc --noEmit -p tsconfig.json` (the PROJECT config) — NEVER `tsc <file>` on a bare path; a bare-file run drops the project lib/options and produces false errors (e.g. TS2339 on readonly arrays). Code that fails ONLY under a bare-file run is NOT a real failure.',
        'End your reply with EXACTLY one line, nothing after it:',
        '`VERDICT: PASS`  (if complete and correct)',
        '`VERDICT: FAIL — <reason>`  (otherwise)',
      ].join('\n');
    default:
      // Wave kinds (research/wimplement/verify/fix) are built by buildWavePrompt, verify
      // kinds by buildVerifyPrompt — never here. Keeps this switch exhaustive over the
      // widened LeafNodeKind.
      throw new Error(`buildNodePrompt: unsupported floor kind "${kind}"`);
  }
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

/** A unit of wave work — a single task (research) or a single file
 *  (wimplement/verify/fix). */
export interface WaveTarget {
  /** Task id (research) or the file path (wimplement/verify/fix). */
  ref: string;
  /** Files in scope (research: the task's files; file-scoped kinds: just [file]). */
  files: string[];
  /** One-line description (research) or the tsc errors to fix (fix). */
  detail: string;
}

/** Build the prompt for a WAVE node (P5). Mirrors buildNodePrompt but is
 *  per-task/per-file. The verify/fix prompts pin the PROJECT tsconfig so
 *  cross-file types resolve (R3). */
export function buildWavePrompt(
  kind: 'research' | 'wimplement' | 'verify' | 'fix',
  leaf: Todo,
  target: WaveTarget,
  ctx?: { blueprintText?: string; researchText?: string },
): string {
  const bp = blueprintPath(leaf);
  const files = target.files.join(', ') || '(none listed)';
  switch (kind) {
    case 'research':
      return [
        `You are a RESEARCH node (READ-ONLY) for task \`${target.ref}\`: ${target.detail}`,
        `Files in scope: ${files}.`,
        'Read the relevant code (Read/Grep/Glob and Bash for inspection ONLY — no edits).',
        `Read the blueprint at \`${bp}\`. Investigate the exact change shape for this task`,
        `and WRITE your findings to \`.collab/leaf-blueprints/${leaf.id}.research.${target.ref}.md\`.`,
        'ALSO output your COMPLETE findings as your FINAL reply message (verbatim) — the',
        'executor inlines that text into the IMPLEMENT node, so it must stand alone even if',
        'the file write fails. Do NOT modify any source file.',
      ].join('\n');
    case 'wimplement': {
      // INLINE the blueprint + research text (mirrors buildNodePrompt's implement case,
      // fix 89f7f6e/b77dd104): a separate `claude -p` runs in a FRESH worktree off the
      // epic tip and the per-leaf blueprint/research files are NOT guaranteed present
      // there — relying on a disk read silently starves the node of context (the
      // waves-file-stuck regression). The executor passes the captured text directly.
      const blueprintBlock = ctx?.blueprintText
        ? `This leaf's blueprint is inlined below — do NOT search for, glob, or read ANY blueprint file (other leaves' blueprints may be present in shared dirs — ignore them entirely).\n\n=== BLUEPRINT (${leaf.id}) START ===\n${ctx.blueprintText}\n=== BLUEPRINT END ===`
        : `Read the blueprint at \`${bp}\` and THIS leaf's research notes (\`.collab/leaf-blueprints/${leaf.id}.research.*.md\`) — ONLY those exact files; ignore any other blueprint in the directory.`;
      const researchBlock = ctx?.researchText
        ? `\n\n=== RESEARCH NOTES (inlined) START ===\n${ctx.researchText}\n=== RESEARCH NOTES END ===`
        : '';
      return [
        `You are the IMPLEMENT node for ONE file: \`${target.ref}\` (Read/Edit only).`,
        blueprintBlock + researchBlock,
        'Implement this file FULLY against the working tree. Do not stub or leave TODOs. Do NOT run the gate.',
      ].join('\n');
    }
    case 'verify':
      return [
        `You are the VERIFY node for file \`${target.ref}\` (READ + Bash for tsc ONLY; no edits).`,
        'From the repo root, run EXACTLY: `npx tsc --noEmit -p tsconfig.json`',
        '(the PROJECT config — never a standalone/temp tsconfig, so cross-file types resolve).',
        `Report the FIRST tsc error touching \`${target.ref}\`, or if there is none output`,
        'EXACTLY one line: `TSC: CLEAN`',
      ].join('\n');
    case 'fix': {
      // Inline the blueprint so the fix has the same intent context as wimplement —
      // a fresh `claude -p` can't be assumed to read it off disk.
      const blueprintBlock = ctx?.blueprintText
        ? `\n\n=== BLUEPRINT (${leaf.id}, inlined — do NOT read other blueprint files) START ===\n${ctx.blueprintText}\n=== BLUEPRINT END ===`
        : '';
      return [
        `You are a FIX node for file \`${target.ref}\` (Read/Edit only).`,
        `Fix these tsc errors:\n${target.detail}`,
        'After editing, do NOT re-run tsc — the executor re-verifies. Read/Edit only.' + blueprintBlock,
      ].join('\n');
    }
  }
}

/** Extract + validate the LAST ```json fence from any of the given sources into a
 *  {@link LeafSizeManifest}. FAIL-SAFE: ANY failure (no fence, JSON error, bad
 *  types) ⇒ returns null, and a null manifest ⇒ FLOOR (see {@link shouldUseFloor}).
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
      return {
        schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
        estimatedFiles,
        estimatedTasks,
        nonEnumerableFanout,
        filesToCreate: toStrArr(raw.filesToCreate),
        filesToEdit: toStrArr(raw.filesToEdit),
        tasks,
      };
    } catch {
      /* not parseable — try the next source, else fall through to null */
    }
  }
  return null;
}

/** P5 size gate (pure, unit-testable). FLOOR iff the manifest is unparseable
 *  (null ⇒ fail-safe to the proven default) OR within BOTH thresholds AND no
 *  non-enumerable fan-out. Anything else ⇒ WAVES. */
export function shouldUseFloor(m: LeafSizeManifest | null): boolean {
  if (!m) return true; // unparseable ⇒ FLOOR (fail-safe)
  return (
    m.estimatedFiles <= FILE_THRESHOLD &&
    m.estimatedTasks <= TASK_THRESHOLD &&
    !m.nonEnumerableFanout
  );
}

/** Which EXECUTION SHAPE a leaf runs (epic f5c7fc46). 'code' (default) is the proven
 *  blueprint→implement/waves→tsc-review AUTHORING pipeline; 'verify' is the non-code
 *  dogfood pipeline (plan → deterministic driver verb → domain gate → committed report).
 *  Keyed off the leaf's `type`: a 'verify'/'cad-dogfood'/'dogfood' type → verify; else
 *  code. THIN dispatch, deliberately NOT a recipe registry (YAGNI — only two real shapes;
 *  see the recipe-space analysis in doc executor-recipe-registry-design). Pure. */
export function leafExecutionMode(leaf: Todo): 'code' | 'verify' {
  const t = (leaf.type ?? '').toLowerCase();
  return t === 'verify' || t === 'cad-dogfood' || t === 'dogfood' ? 'verify' : 'code';
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

export function parseVerdict(text: string | undefined): 'pass' | 'fail' {
  if (!text) return 'fail';
  return /^\s*VERDICT:\s*PASS\b/im.test(stripSentinelFmt(text)) ? 'pass' : 'fail';
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

/** True when a verify node reported a clean tsc result. Tolerant of markdown wrapping
 *  (`TSC: CLEAN` in backticks) and empty output (nothing to report = clean). */
export function isTscClean(text: string | undefined): boolean {
  const t = stripSentinelFmt((text ?? '').trim()).trim();
  return t === '' || /^TSC:\s*CLEAN\b/im.test(t);
}

/** Stable per-leaf lane name. WorktreeManager keys records on this; `fresh:true`
 *  tears down the prior dir+branch so every attempt is a NEW branch off the tip. */
export function leafSessionKey(leaf: Todo): string {
  return `leaf-exec-${leaf.id.slice(0, 8)}`;
}

/**
 * Drive ONE leaf todo through the deterministic blueprint→implement→review loop.
 *
 * @param project The TRACKING project (where the todo + lease live).
 * @param leaf    The claimed leaf todo (already in_progress).
 * @param deps    Injected seam. Use {@link makeLeafExecutorDeps} for the real wiring.
 */
export async function runLeaf(
  project: string,
  leaf: Todo,
  deps: LeafExecutorDeps,
): Promise<LeafRunResult> {
  // Fail-fast auth gate — ONCE, before any node. Throws under an API key; the
  // launchWorker branch catches → release + escalate (no tmux fallback).
  deps.assertAuth();

  const sessionKey = leafSessionKey(leaf);
  const { epicId, epicBranch } = deps;

  // Single mutable run-state held in this closure (the budget counter must span
  // ALL attempts and ALL node kinds).
  // nodesSpent is SEEDED from startNodesSpent (P3 resume) so the master budget is
  // global across pause/resume cycles, not reset per re-dispatch.
  const state = { attempt: 0, nodesSpent: deps.startNodesSpent ?? 0 };
  // Which execution path the last attempt took — recorded on the terminal record so a
  // run's shape (and which path a failure came from) is legible without re-deriving.
  let pathTaken: 'floor' | 'waves' | null = null;

  // Per-(project, node-kind) model + effort overrides, resolved once per run.
  // model  : per-kind override → NODE_PROFILE default.
  // effort : per-kind override → per-project blanket (getProjectEffort) →
  //          MERMAID_NODE_EFFORT env → per-kind NODE_PROFILE default.
  const nodeOverrides = listNodeProfileOverrides(project);
  const projectEffort = getProjectEffort(project);
  const nodeModel = (kind: LeafNodeKind): string => nodeOverrides[kind]?.model ?? NODE_PROFILE[kind].model;
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
    state.nodesSpent += 1;
    // LIVE signal: mark the leaf as running THIS node before the (slow) spawn, clear it
    // the instant the node returns — so the in-flight node is visible cross-process.
    deps.setInflight?.({ project, leafId: leaf.id, epicId, nodeKind: kind, model: nodeModel(kind), attempt: state.attempt });
    let res: NodeResult;
    try {
      res = await deps.invoker.invoke(spec);
    } finally {
      deps.clearInflight?.(leaf.id);
    }
    try {
      deps.recordNode({
        project,
        todoId: leaf.id,
        session: sessionKey,
        epicId,
        leafId: leaf.id,
        nodeKind: kind,
        model: nodeModel(kind),
        nodesSpent: 1,
        authMode: res.authMode,
        exitCode: res.exitCode,
        durationMs: res.durationMs,
        rateLimited: res.rateLimited,
        inputTokens: res.usage?.inputTokens,
        outputTokens: res.usage?.outputTokens,
        costUsd: res.usage?.costUsd,
        steps: res.usage?.numTurns,
        parseError: res.parseError ?? null,
        verdict: extra?.verdict ?? null,
        leafOutcome: extra?.leafOutcome ?? null,
        // Persist the node's final message so a stuck/rejected leaf is diagnosable
        // (and UI-surfaceable) after the fact — the tsc error, review reason, etc.
        outputText: res.text ?? null,
      });
    } catch {
      /* ledger is telemetry — never break the run */
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
    return { outcome: 'blocked', attempts: state.attempt, nodesSpent: state.nodesSpent, reason };
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
    cwd,
    leafId: leaf.id,
    epicId,
    permissionMode: 'bypassPermissions',
    transcriptPath: leafTranscriptPath(project, leaf.id),
    transcriptLabel: kind,
  });

  /** Per-task/per-file wave NodeSpec — mirrors buildSpec but uses buildWavePrompt. */
  const buildWaveSpec = (
    kind: 'research' | 'wimplement' | 'verify' | 'fix',
    cwd: string,
    target: WaveTarget,
    ctx?: { blueprintText?: string; researchText?: string },
  ): NodeSpec => ({
    prompt: buildWavePrompt(kind, leaf, target, ctx),
    model: nodeModel(kind),
    effort: nodeEffort(kind),
    allowedTools: NODE_PROFILE[kind].allowedTools,
    cwd,
    leafId: leaf.id,
    epicId,
    permissionMode: 'bypassPermissions',
    transcriptPath: leafTranscriptPath(project, leaf.id),
    transcriptLabel: `${kind}:${target.ref}`,
  });

  /**
   * P5 WAVES path. Runs research→wimplement→verify per task/file, a per-file fix
   * loop (same-error-twice = stuck), and a final wave-level project-wide tsc gate.
   * Owns NO budget logic — EVERY node goes through `runNode` (nodesSpent++ before
   * spawn) and `checkBudget()`/`res.rateLimited` are checked after each, so the
   * ceilings are byte-identical to the floor.
   *
   * Returns null ⇒ all files clean → caller falls through to the leaf REVIEW node.
   * Returns a LeafRunResult ⇒ a terminal short-circuit (paused / blocked) to return.
   */
  const runWaves = async (
    manifest: LeafSizeManifest,
    cwd: string,
    blueprintBody?: string,
  ): Promise<LeafRunResult | null> => {
    // Per-file work set: tasks[].files ∪ filesToCreate ∪ filesToEdit, de-duped.
    const fileSet: string[] = [];
    const addFile = (f: string): void => { if (f && !fileSet.includes(f)) fileSet.push(f); };
    for (const f of manifest.filesToCreate) addFile(f);
    for (const f of manifest.filesToEdit) addFile(f);
    for (const t of manifest.tasks) for (const f of t.files) addFile(f);

    // 1. RESEARCH wave — one node per task. v1: sequential (deterministic budget
    //    accounting; parallelism is an additive follow-up).
    const researchNotes: string[] = [];
    for (const t of manifest.tasks) {
      const res = await runNode('research', buildWaveSpec('research', cwd, {
        ref: t.id, files: t.files, detail: t.description,
      }));
      if (res.rateLimited) return pausedResult('research', res);
      // Capture the research node's findings to INLINE into wimplement (the node runs
      // in a fresh worktree and can't be assumed to read the .research.*.md off disk).
      if (res.text && res.text.trim()) {
        researchNotes.push(`## Task ${t.id}: ${t.description}\n${res.text.trim()}`);
      }
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    }
    const researchText = researchNotes.length ? researchNotes.join('\n\n---\n\n') : undefined;

    // 2+3+4+5. Per file: IMPLEMENT → VERIFY → per-file FIX loop.
    for (const file of fileSet) {
      const impl = await runNode('wimplement', buildWaveSpec('wimplement', cwd, {
        ref: file, files: [file], detail: '',
      }, { blueprintText: blueprintBody, researchText }));
      if (impl.rateLimited) return pausedResult('wimplement', impl);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');

      // No-op short-circuit: if the wimplement made NO change to this file, it was
      // already satisfied in the worktree baseline — skip its per-file verify (the
      // final project-wide gate still backstops). Avoids burning a verify node per
      // already-done file (the budget-exhaustion-on-done-work failure). Only when the
      // change-set is readable; null (unwired / non-git) → verify as before.
      const implChangeSet = deps.changeSet ? await deps.changeSet(sessionKey) : null;
      if (implChangeSet && !isInChangeSet(file, implChangeSet)) {
        continue; // already-done file → next file
      }

      // VERIFY + per-file FIX loop. same-error-signature-twice = stuck.
      let previousError: string | null = null;
      for (;;) {
        const ver = await runNode('verify', buildWaveSpec('verify', cwd, {
          ref: file, files: [file], detail: '',
        }));
        if (ver.rateLimited) return pausedResult('verify', ver);
        if (!checkBudget()) return parkBlocked('node-budget-exhausted');

        const errText = (ver.text ?? '').trim();
        if (isTscClean(ver.text)) break; // file clean (tolerant of `TSC: CLEAN` markdown wrapping)

        if (previousError !== null && errText === previousError) {
          return parkBlocked('waves-file-stuck'); // same error twice ⇒ stuck
        }
        previousError = errText;

        const fix = await runNode('fix', buildWaveSpec('fix', cwd, {
          ref: file, files: [file], detail: errText,
        }, { blueprintText: blueprintBody }));
        if (fix.rateLimited) return pausedResult('fix', fix);
        if (!checkBudget()) return parkBlocked('node-budget-exhausted');
      }
    }

    // 6. WAVE-LEVEL tsc gate — one final project-wide verify. Must be clean.
    const gate = await runNode('verify', buildWaveSpec('verify', cwd, {
      ref: '<project>', files: fileSet, detail: '',
    }));
    if (gate.rateLimited) return pausedResult('verify', gate);
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    if (!isTscClean(gate.text)) {
      // The gate runs PROJECT-WIDE tsc, so a PRE-EXISTING error in a file this leaf
      // never touched would otherwise block an otherwise-clean leaf. Scope the failure
      // to the leaf's change-set — the same contract the completion gate already uses
      // (scopeFailureToChangeSet): foreign-only errors PASS; an error in a file the leaf
      // changed still blocks. When the change-set is unavailable (unwired / non-git), the
      // scope returns null → we fail closed exactly as before.
      const gateChangeSet = deps.changeSet ? await deps.changeSet(sessionKey) : null;
      const scoped = scopeFailureToChangeSet(gate.text ?? '', gateChangeSet);
      if (!scoped?.passed) {
        return parkBlocked('waves-tsc-gate-failed');
      }
      // foreign-only tsc errors → the leaf's own files are clean → gate passes.
    }

    return null; // all clean → caller runs the leaf REVIEW node
  };

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
    const gateVerdict: 'pass' | 'fail' = findings.length === 0 ? 'pass' : 'fail';

    // COMMIT-SHAPED DELIVERABLE: merge the worktree (the committed report) onto the epic
    // branch BEFORE proposing acceptance, exactly like the code path, so the gate's
    // work-committed re-verify sees committed work. The verify leaf's success is "it verified
    // and reported" — a failing DOMAIN gate is captured in the report + filed findings, not a
    // rejected leaf.
    try {
      await deps.mergeToEpic(sessionKey, epicId, `verify: ${leaf.title ?? leaf.id}`, leaf.id);
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
    return {
      outcome: effective,
      attempts: state.attempt,
      nodesSpent: state.nodesSpent,
      ...(reason ? { reason } : {}),
    };
  };

  // EXECUTION-MODE DISPATCH (epic f5c7fc46): a 'verify' leaf runs the non-code dogfood
  // pipeline above (plan → deterministic build_assembly_plan → domain gate → committed
  // report), NOT the code authoring loop below — force-fitting it into blueprint→implement→
  // tsc is exactly the build123d T14 failure this epic fixes (vacuous "TSC: CLEAN" on a CAD
  // task). L1 dispatched to a stub; L2 lands the real pipeline.
  if (leafExecutionMode(leaf) === 'verify') {
    return runVerifyPipeline();
  }

  // ATTEMPT loop — n in [0, ATTEMPT_CAP). A FRESH worktree off the epic tip every
  // iteration (no surgical reuse of the prior attempt's edits — that's P6).
  for (state.attempt = 0; state.attempt < ATTEMPT_CAP; ) {
    state.attempt += 1; // 1-based count for telemetry/escalation
    const isLastAttempt = state.attempt >= ATTEMPT_CAP;

    const wt = await deps.wm.ensure(sessionKey, { baseBranch: epicBranch, fresh: true });
    const cwd = wt.path;

    // BLUEPRINT — rate-limit check FIRST (a capped node produced no usable work; we
    // must not interpret its empty/error output as a FAIL nor advance the attempt).
    let bp = await runNode('blueprint', buildSpec('blueprint', cwd));
    if (bp.rateLimited) return pausedResult('blueprint', bp);
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');

    // L1-pilot finding (ce02d796): a blueprint node that FAILED (non-zero exit /
    // errored — NOT rate-limited, which is handled above) wrote no usable blueprint.
    // Proceeding to implement+review against a missing blueprint wastes two nodes on
    // a guaranteed review FAIL and burns the whole attempt. Give it ONE in-place
    // retry (still counted against the node budget); if it still fails, short-circuit
    // to a fresh attempt rather than running the rest of the pipeline blind.
    if (!bp.ok) {
      bp = await runNode('blueprint', buildSpec('blueprint', cwd));
      if (bp.rateLimited) return pausedResult('blueprint', bp);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    }
    if (!bp.ok) {
      if (isLastAttempt) return parkBlocked('blueprint-node-failed');
      continue; // fresh attempt — never implement against a missing blueprint
    }

    // --- P5 SIZE GATE ---
    // Read the blueprint artifact (its trailing ```json size block) and derive the
    // manifest. Unparseable ⇒ null ⇒ shouldUseFloor true ⇒ the proven FLOOR path.
    const manifestText = await deps.readBlueprint?.(cwd, leaf).catch(() => undefined);
    const manifest = parseSizeManifest(manifestText, bp.text);
    // Unconditional inline source (b77dd104): prefer the read-back .md, else the
    // blueprint node's own final-message text — so implement/review NEVER fall back to
    // globbing the shared blueprint dir (which leaked OTHER leaves' blueprints and made
    // the executor build the wrong feature). The blueprint node is instructed to emit
    // its full text as its final message, so bp.text is a reliable fallback.
    const blueprintBody = manifestText && manifestText.trim() ? manifestText : bp.text;

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

    // --- AUTO-SPLIT (worker-decomposition) ---
    // A leaf whose blueprint ENUMERATES more files than one run should carry is split
    // PRE-FLIGHT into one child leaf per file under THIS leaf (which becomes a
    // non-executable dependency-grouping container). Children commit to the SAME enclosing
    // epic branch (resolveEpicId walks past this node) and complete as ordinary leaves;
    // sweepEpicRollups closes this container when they all settle — NO new branch, NO land
    // gate (the epic's LAND leaf stays the sole merge-to-master authority). Only when the
    // fanout is ENUMERABLE — a non-enumerable manifest can't be partitioned, so it falls
    // through to WAVES. Guarded by deps.splitInto (unwired ⇒ never splits).
    if (deps.splitInto && manifest && !manifest.nonEnumerableFanout) {
      const splitFiles = [...new Set([
        ...manifest.filesToCreate, ...manifest.filesToEdit, ...manifest.tasks.flatMap((t) => t.files),
      ])];
      if (splitFiles.length > SPLIT_CEILING) {
        await deps.splitInto(leaf, splitFiles);
        return { outcome: 'split', attempts: state.attempt, nodesSpent: state.nodesSpent };
      }
    }

    if (!shouldUseFloor(manifest)) {
      pathTaken = 'waves';
      // Lift the runaway ceiling to the size-aware waves budget (unless a test pinned one),
      // so a legitimately large multi-file leaf isn't false-killed mid-wave.
      if (deps.nodeBudget == null && manifest) {
        const fileCount = new Set([
          ...manifest.filesToCreate, ...manifest.filesToEdit, ...manifest.tasks.flatMap((t) => t.files),
        ]).size;
        budget = Math.max(budget, wavesBudget(manifest.tasks.length, fileCount));
      }
      // WAVES — research/wimplement/verify/fix; budget/pause/stuck short-circuit here.
      const wavesResult = await runWaves(manifest!, cwd, blueprintBody);
      if (wavesResult) return wavesResult;
      // waves completed all files clean → FALL THROUGH to the REVIEW node below.
    } else {
      pathTaken = 'floor';
      // FLOOR — UNCHANGED implement node (byte-identical to P2):
      // IMPLEMENT
      const impl = await runNode('implement', buildSpec('implement', cwd, blueprintBody));
      if (impl.rateLimited) return pausedResult('implement', impl);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
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
    for (;;) {
      const review = await runNode('review', buildSpec('review', cwd, blueprintBody));
      if (review.rateLimited) return pausedResult('review', review);
      reviewVerdict = parseVerdict(review.text);
      const findings = (review.text ?? '').trim();
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
        );
      } catch (e) {
        // Merge-back failed (e.g. conflict) → can't safely accept. Park blocked.
        return parkBlocked(
          `merge-to-epic-failed: ${e instanceof Error ? e.message : String(e)}`,
          reviewVerdict,
        );
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
        reason,
        pendingReason: gate.pendingReason,
        gateReasons: gate.gateReasons,
      });
      return {
        outcome,
        attempts: state.attempt,
        nodesSpent: state.nodesSpent,
        ...(reason ? { reason } : {}),
      };
    }

    // REVIEW FAIL → next fresh attempt, unless the cap is exhausted.
    if (isLastAttempt) return parkBlocked('attempt-cap-exhausted', reviewVerdict);
  }

  // Unreachable in practice (the loop returns), but keeps the type total.
  return parkBlocked('attempt-cap-exhausted');
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
  const epicId = resolveEpicId(leaf, project);
  // Materialise the epic accumulation branch so the off-tip base exists.
  const epic = await wm.ensureEpic(epicId, targetProject);
  const epicBranch = epic?.branch ?? 'master';
  return {
    invoker: ClaudeNodeInvoker,
    wm,
    epicId,
    epicBranch,
    assertAuth: assertSubscriptionAuth,
    complete: async (p, t, a) => {
      // Carry the gate's pendingReason + failing-gate reasons OUT of the funnel — the
      // leaf-executor's terminal record needs them (they were silently dropped before).
      const r = await handleWorkerComplete(makeCoordinatorDeps(), p, t, a);
      return { effective: r.effective, pendingReason: r.pendingReason, gateReasons: r.gateOverride?.reasons };
    },
    mergeToEpic: (sessionKey, eId, message, todoId) =>
      wm.commitAndMergeToEpic(sessionKey, eId, { message, todoId }),
    changeSet: (sessionKey) => wm.changeSet(sessionKey, epicBranch),
    splitInto: async (lf, files) => { await splitLeafInto(project, lf, files); },
    escalate: createEscalation,
    recordNode,
    setInflight: setLeafInflight,
    clearInflight: clearLeafInflight,
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
    startNodesSpent,
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
