/**
 * MINIMAL leaf-executor (PAW P2) — the deterministic FLOOR.
 *
 * Drives ONE leaf todo through an automated blueprint→implement→review loop by
 * chaining the P1 headless node primitive (`invokeNode`), reusing the EXISTING
 * worktree-manager (fresh worktree off the epic tip) and the EXISTING completion
 * funnel (`handleWorkerComplete`) as the acceptance gate. There are NO waves, NO
 * inner task graph, and NO surgical reuse — those are P5/P6. Each node is a single
 * shot. The whole thing ships behind the `LEAF_EXECUTOR` env gate (default OFF);
 * the legacy tmux launch path in coordinator-live is the unchanged fallback.
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

import type { Todo } from './todo-store';
import type { NodeInvoker, NodeResult, NodeSpec, AuthMode } from '../agent/node-invoker';
import type { WorktreeManager } from '../agent/worktree-manager';
import { ClaudeNodeInvoker, assertSubscriptionAuth } from '../agent/node-invoker';
import { getWorktreeManager, resolveEpicId, makeCoordinatorDeps } from './coordinator-live';
import { handleWorkerComplete } from './coordinator-daemon';
import { createEscalation } from './supervisor-store';
import { recordNode } from './worker-ledger';

/** Node kinds. The floor chains blueprint→implement→review (unchanged). P5 adds the
 *  wave kinds (research/wimplement/verify/fix); `'implement'` stays RESERVED for the
 *  floor so floor ledger rows are byte-identical. */
export type LeafNodeKind =
  | 'blueprint' | 'implement' | 'review' // floor (unchanged)
  | 'research' | 'wimplement' | 'verify' | 'fix'; // waves (P5)

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
  ) => Promise<{ effective?: 'accepted' | 'rejected' | 'pending' }>;
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
  /** Master node budget override (TEST seam). Default {@link NODE_BUDGET}=20. The
   *  floor structurally spends ≤6 nodes (3/attempt × cap 2); this backstop catches a
   *  runaway node (e.g. one that internally loops). Lowerable in tests to exercise
   *  the budget ceiling deterministically without faking a 20-node run. */
  nodeBudget?: number;
  now?: () => number;
  /** P5 size-gate seam: read back the blueprint artifact (the .md the blueprint
   *  node wrote, including its trailing ```json size block) so the executor can
   *  derive the {@link LeafSizeManifest}. Default reads
   *  `path.join(cwd, blueprintPath(leaf))` via fs; tests inject the text directly.
   *  Optional `?.` keeps the floor working even if unwired (→ undefined → null
   *  manifest → FLOOR, the fail-safe default). */
  readBlueprint?: (cwd: string, leaf: Todo) => Promise<string | undefined>;
  /** Resume seam (P3): seed `state.nodesSpent` so total spawns across all
   *  pause/resume cycles stay bounded by the master {@link NODE_BUDGET}. The daemon
   *  (headless-breaker) carries the paused leaf's prior `nodesSpent` in here on
   *  re-dispatch. Defaults 0 (a fresh, never-paused leaf). */
  startNodesSpent?: number;
}

export interface LeafRunResult {
  outcome: 'accepted' | 'rejected' | 'blocked' | 'paused';
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

/** P5 size-gate thresholds (tunable). A leaf is FLOOR-eligible iff it touches
 *  `<= FILE_THRESHOLD` files AND `<= TASK_THRESHOLD` tasks AND has no
 *  non-enumerable fan-out. Over any of these ⇒ WAVES. */
export const FILE_THRESHOLD = 4;
export const TASK_THRESHOLD = 6;

/** Per-node model + tool allowlist (blueprint §3). Bash is read-only by prompt
 *  convention (the CLI has no RO-bash flag). The space-separated list is passed
 *  straight to `--allowedTools` by the P1 invoker. */
const NODE_PROFILE: Record<LeafNodeKind, { model: string; allowedTools: string }> = {
  blueprint: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash' },
  implement: { model: 'sonnet', allowedTools: 'Read Edit Grep Glob Bash' },
  review: { model: 'opus', allowedTools: 'Read Grep Glob Bash' },
  // P5 waves:
  research: { model: 'opus', allowedTools: 'Read Grep Glob Bash' }, // read-only
  wimplement: { model: 'sonnet', allowedTools: 'Read Edit Grep Glob Bash' }, // read+edit
  verify: { model: 'sonnet', allowedTools: 'Read Grep Glob Bash' }, // read + bash-tsc
  fix: { model: 'sonnet', allowedTools: 'Read Edit Grep Glob Bash' }, // read+edit
};

/** Fixed in-worktree path the blueprint node writes to and the later nodes read. */
function blueprintPath(leaf: Todo): string {
  return `.collab/leaf-blueprints/${leaf.id}.md`;
}

/** Build the inline prompt for a node kind (clones the LOGIC of vibe-blueprint /
 *  vibe-go worker / vibe-review as a self-contained string — references NOTHING
 *  in skills/). */
export function buildNodePrompt(kind: LeafNodeKind, leaf: Todo): string {
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
      ].join('\n');
    case 'implement':
      return [
        'You are the IMPLEMENT node. Make REAL, compiling code edits (Read/Edit only).',
        `Read the blueprint at \`${bp}\` and the files it references, then implement it FULLY.`,
        'Do not stub or leave TODOs. Do NOT run the acceptance gate or report completion —',
        'the executor drives the gate. Just make the edits the blueprint specifies.',
      ].join('\n');
    case 'review':
      return [
        'You are the REVIEW node, READ-ONLY (Read/Grep/Glob and Bash for inspection ONLY; no edits).',
        `Compare the working tree against the blueprint at \`${bp}\`. Decide if the work is`,
        'complete and correct (it compiles, satisfies the blueprint, no obvious bugs).',
        'End your reply with EXACTLY one line, nothing after it:',
        '`VERDICT: PASS`  (if complete and correct)',
        '`VERDICT: FAIL — <reason>`  (otherwise)',
      ].join('\n');
    default:
      // Wave kinds (research/wimplement/verify/fix) are built by buildWavePrompt,
      // never here. Keeps this switch exhaustive over the widened LeafNodeKind.
      throw new Error(`buildNodePrompt: unsupported floor kind "${kind}"`);
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
        `and WRITE your findings to \`.collab/leaf-blueprints/${leaf.id}.research.${target.ref}.md\``,
        'so the IMPLEMENT node can read them. Do NOT modify any source file.',
      ].join('\n');
    case 'wimplement':
      return [
        `You are the IMPLEMENT node for ONE file: \`${target.ref}\` (Read/Edit only).`,
        `Read the blueprint at \`${bp}\` and any research notes in \`.collab/leaf-blueprints/\`,`,
        'then implement this file FULLY. Do not stub or leave TODOs. Do NOT run the gate.',
      ].join('\n');
    case 'verify':
      return [
        `You are the VERIFY node for file \`${target.ref}\` (READ + Bash for tsc ONLY; no edits).`,
        'From the repo root, run EXACTLY: `npx tsc --noEmit -p tsconfig.json`',
        '(the PROJECT config — never a standalone/temp tsconfig, so cross-file types resolve).',
        `Report the FIRST tsc error touching \`${target.ref}\`, or if there is none output`,
        'EXACTLY one line: `TSC: CLEAN`',
      ].join('\n');
    case 'fix':
      return [
        `You are a FIX node for file \`${target.ref}\` (Read/Edit only).`,
        `Fix these tsc errors:\n${target.detail}`,
        'After editing, do NOT re-run tsc — the executor re-verifies. Read/Edit only.',
      ].join('\n');
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

/** Parse a REVIEW node's text for the verdict line. Fail-closed: a missing or
 *  unparseable verdict is treated as FAIL. */
export function parseVerdict(text: string | undefined): 'pass' | 'fail' {
  if (!text) return 'fail';
  return /^VERDICT:\s*PASS\b/im.test(text) ? 'pass' : 'fail';
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

  const budget = deps.nodeBudget ?? NODE_BUDGET;
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
    const res = await deps.invoker.invoke(spec);
    try {
      deps.recordNode({
        project,
        todoId: leaf.id,
        session: sessionKey,
        epicId,
        leafId: leaf.id,
        nodeKind: kind,
        model: NODE_PROFILE[kind].model,
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
    recordOutcome('blocked', verdict);
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

  const buildSpec = (kind: LeafNodeKind, cwd: string): NodeSpec => ({
    prompt: buildNodePrompt(kind, leaf),
    model: NODE_PROFILE[kind].model,
    allowedTools: NODE_PROFILE[kind].allowedTools,
    cwd,
    leafId: leaf.id,
    epicId,
    permissionMode: 'bypassPermissions',
  });

  /** Per-task/per-file wave NodeSpec — mirrors buildSpec but uses buildWavePrompt. */
  const buildWaveSpec = (
    kind: 'research' | 'wimplement' | 'verify' | 'fix',
    cwd: string,
    target: WaveTarget,
  ): NodeSpec => ({
    prompt: buildWavePrompt(kind, leaf, target),
    model: NODE_PROFILE[kind].model,
    allowedTools: NODE_PROFILE[kind].allowedTools,
    cwd,
    leafId: leaf.id,
    epicId,
    permissionMode: 'bypassPermissions',
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
  ): Promise<LeafRunResult | null> => {
    // Per-file work set: tasks[].files ∪ filesToCreate ∪ filesToEdit, de-duped.
    const fileSet: string[] = [];
    const addFile = (f: string): void => { if (f && !fileSet.includes(f)) fileSet.push(f); };
    for (const f of manifest.filesToCreate) addFile(f);
    for (const f of manifest.filesToEdit) addFile(f);
    for (const t of manifest.tasks) for (const f of t.files) addFile(f);

    // 1. RESEARCH wave — one node per task. v1: sequential (deterministic budget
    //    accounting; parallelism is an additive follow-up).
    for (const t of manifest.tasks) {
      const res = await runNode('research', buildWaveSpec('research', cwd, {
        ref: t.id, files: t.files, detail: t.description,
      }));
      if (res.rateLimited) return pausedResult('research', res);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    }

    // 2+3+4+5. Per file: IMPLEMENT → VERIFY → per-file FIX loop.
    for (const file of fileSet) {
      const impl = await runNode('wimplement', buildWaveSpec('wimplement', cwd, {
        ref: file, files: [file], detail: '',
      }));
      if (impl.rateLimited) return pausedResult('wimplement', impl);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');

      // VERIFY + per-file FIX loop. same-error-signature-twice = stuck.
      let previousError: string | null = null;
      for (;;) {
        const ver = await runNode('verify', buildWaveSpec('verify', cwd, {
          ref: file, files: [file], detail: '',
        }));
        if (ver.rateLimited) return pausedResult('verify', ver);
        if (!checkBudget()) return parkBlocked('node-budget-exhausted');

        const errText = (ver.text ?? '').trim();
        if (/^TSC:\s*CLEAN\b/im.test(errText) || errText === '') break; // file clean

        if (previousError !== null && errText === previousError) {
          return parkBlocked('waves-file-stuck'); // same error twice ⇒ stuck
        }
        previousError = errText;

        const fix = await runNode('fix', buildWaveSpec('fix', cwd, {
          ref: file, files: [file], detail: errText,
        }));
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
    const gateText = (gate.text ?? '').trim();
    if (!(/^TSC:\s*CLEAN\b/im.test(gateText) || gateText === '')) {
      return parkBlocked('waves-tsc-gate-failed');
    }

    return null; // all clean → caller runs the leaf REVIEW node
  };

  // ATTEMPT loop — n in [0, ATTEMPT_CAP). A FRESH worktree off the epic tip every
  // iteration (no surgical reuse of the prior attempt's edits — that's P6).
  for (state.attempt = 0; state.attempt < ATTEMPT_CAP; ) {
    state.attempt += 1; // 1-based count for telemetry/escalation
    const isLastAttempt = state.attempt >= ATTEMPT_CAP;

    const wt = await deps.wm.ensure(sessionKey, { baseBranch: epicBranch, fresh: true });
    const cwd = wt.path;

    // BLUEPRINT — rate-limit check FIRST (a capped node produced no usable work; we
    // must not interpret its empty/error output as a FAIL nor advance the attempt).
    const bp = await runNode('blueprint', buildSpec('blueprint', cwd));
    if (bp.rateLimited) return pausedResult('blueprint', bp);
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');

    // --- P5 SIZE GATE ---
    // Read the blueprint artifact (its trailing ```json size block) and derive the
    // manifest. Unparseable ⇒ null ⇒ shouldUseFloor true ⇒ the proven FLOOR path.
    const manifestText = await deps.readBlueprint?.(cwd, leaf).catch(() => undefined);
    const manifest = parseSizeManifest(manifestText, bp.text);
    if (!shouldUseFloor(manifest)) {
      // WAVES — research/wimplement/verify/fix; budget/pause/stuck short-circuit here.
      const wavesResult = await runWaves(manifest!, cwd);
      if (wavesResult) return wavesResult;
      // waves completed all files clean → FALL THROUGH to the REVIEW node below.
    } else {
      // FLOOR — UNCHANGED implement node (byte-identical to P2):
      // IMPLEMENT
      const impl = await runNode('implement', buildSpec('implement', cwd));
      if (impl.rateLimited) return pausedResult('implement', impl);
      if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    }

    // REVIEW (parse PASS/FAIL — fail-closed).
    const review = await runNode('review', buildSpec('review', cwd));
    if (review.rateLimited) return pausedResult('review', review);
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');
    // P4a R1: the verdict is known the instant the review node returns. It is
    // carried into the terminal marker row (recordOutcome) so the read-side can
    // surface reviewVerdict alongside the final outcome.
    const reviewVerdict = parseVerdict(review.text);

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
      const outcome: LeafRunResult['outcome'] = effective === 'accepted' ? 'accepted' : 'rejected';
      recordOutcome(outcome, reviewVerdict);
      return {
        outcome,
        attempts: state.attempt,
        nodesSpent: state.nodesSpent,
        ...(effective === 'pending' ? { reason: 'gate-pending' } : {}),
      };
    }

    // REVIEW FAIL → next fresh attempt, unless the cap is exhausted.
    if (isLastAttempt) return parkBlocked('attempt-cap-exhausted', reviewVerdict);
  }

  // Unreachable in practice (the loop returns), but keeps the type total.
  return parkBlocked('attempt-cap-exhausted');
}

/**
 * Factory wiring the REAL dependencies. Resolves the epic id (walking parentId in
 * the tracking project), materialises the epic branch, and binds the production
 * invoker/gate/escalation/ledger. Used by the `launchWorker` LEAF_EXECUTOR branch.
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
    complete: (p, t, a) => handleWorkerComplete(makeCoordinatorDeps(), p, t, a),
    mergeToEpic: (sessionKey, eId, message, todoId) =>
      wm.commitAndMergeToEpic(sessionKey, eId, { message, todoId }),
    escalate: createEscalation,
    recordNode,
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
    startNodesSpent,
  };
}
