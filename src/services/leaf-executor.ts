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

/** The three node kinds the floor chains, in order. */
export type LeafNodeKind = 'blueprint' | 'implement' | 'review';

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
}

export interface LeafRunResult {
  outcome: 'accepted' | 'rejected' | 'blocked';
  attempts: number;
  nodesSpent: number;
  /** Set on a 'blocked' outcome (the cap/budget reason). */
  reason?: string;
}

export const ATTEMPT_CAP = 2;
export const NODE_BUDGET = 20;

/** Per-node model + tool allowlist (blueprint §3). Bash is read-only by prompt
 *  convention (the CLI has no RO-bash flag). The space-separated list is passed
 *  straight to `--allowedTools` by the P1 invoker. */
const NODE_PROFILE: Record<LeafNodeKind, { model: string; allowedTools: string }> = {
  blueprint: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash' },
  implement: { model: 'sonnet', allowedTools: 'Read Edit Grep Glob Bash' },
  review: { model: 'opus', allowedTools: 'Read Grep Glob Bash' },
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
  }
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
  const state = { attempt: 0, nodesSpent: 0 };

  const budget = deps.nodeBudget ?? NODE_BUDGET;
  /** TRUE while still within the master node budget. */
  const checkBudget = (): boolean => state.nodesSpent <= budget;

  /** Single wrapper used for EVERY invokeNode call: increment BEFORE the spawn
   *  (so a hanging node still counts toward the budget), invoke, then a best-effort
   *  ledger write. */
  const runNode = async (kind: LeafNodeKind, spec: NodeSpec): Promise<NodeResult> => {
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
      });
    } catch {
      /* ledger is telemetry — never break the run */
    }
    return res;
  };

  /** Park BLOCKED: route a final 'rejected' through the SAME gate so dependents
   *  settle, raise an escalation card, and return the blocked result. */
  const parkBlocked = async (reason: string): Promise<LeafRunResult> => {
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

  const buildSpec = (kind: LeafNodeKind, cwd: string): NodeSpec => ({
    prompt: buildNodePrompt(kind, leaf),
    model: NODE_PROFILE[kind].model,
    allowedTools: NODE_PROFILE[kind].allowedTools,
    cwd,
    leafId: leaf.id,
    epicId,
    permissionMode: 'bypassPermissions',
  });

  // ATTEMPT loop — n in [0, ATTEMPT_CAP). A FRESH worktree off the epic tip every
  // iteration (no surgical reuse of the prior attempt's edits — that's P6).
  for (state.attempt = 0; state.attempt < ATTEMPT_CAP; ) {
    state.attempt += 1; // 1-based count for telemetry/escalation
    const isLastAttempt = state.attempt >= ATTEMPT_CAP;

    const wt = await deps.wm.ensure(sessionKey, { baseBranch: epicBranch, fresh: true });
    const cwd = wt.path;

    // BLUEPRINT
    await runNode('blueprint', buildSpec('blueprint', cwd));
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');

    // IMPLEMENT
    await runNode('implement', buildSpec('implement', cwd));
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');

    // REVIEW (parse PASS/FAIL — fail-closed)
    const review = await runNode('review', buildSpec('review', cwd));
    if (!checkBudget()) return parkBlocked('node-budget-exhausted');

    if (parseVerdict(review.text) === 'pass') {
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
        );
      }
      const gate = await deps.complete(project, leaf.id, 'accepted');
      const effective = gate.effective ?? 'accepted';
      return {
        outcome: effective === 'accepted' ? 'accepted' : 'rejected',
        attempts: state.attempt,
        nodesSpent: state.nodesSpent,
        ...(effective === 'pending' ? { reason: 'gate-pending' } : {}),
      };
    }

    // REVIEW FAIL → next fresh attempt, unless the cap is exhausted.
    if (isLastAttempt) return parkBlocked('attempt-cap-exhausted');
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
  };
}
