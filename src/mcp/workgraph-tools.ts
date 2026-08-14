// Work-graph constructor MCP tool surface — the three PUBLIC creation verbs that
// wrap the existing todo-store primitives (createTodo / ensureBucket) with the
// invariants callers keep forgetting: every non-bucket epic gets its terminal
// [LAND]→master leaf, every leaf belongs to an epic, and bucket titles are refused.
//
// Follows the mission-tools.ts pattern EXACTLY: this module exports the ListTools
// declarations (WORKGRAPH_TOOL_DEFS) + the CallTool dispatch (handleWorkgraphTool),
// both wired into setup.ts the same way. The handler bodies delegate to shared
// plain functions (createEpicWithLandLeaf / addLeavesToEpic / fileToBucketLeaf) so
// the REST routes in api.ts are thin wrappers over the identical logic.
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
import { getTodo, updateTodo, removeTodo, deriveTodoViews, isBucketEpicTitle, listTodos, type Todo, type TodoStatus, type TodoLink, type LeafTier } from '../services/todo-store.js';
import { computeWorkgraphHealth } from '../services/workgraph-health.js';
import { isEpic, isMission, stripLabel } from '../services/todo-kind.js';
import { ensureBucket, type BucketType } from '../services/bucket-registry.js';
import { ensureExploreRunEpic } from '../services/explore-run-epic.js';
import { addSessionTodo } from './tools/session-todos.js';
import { trackingProjectRoot } from '../services/project-registry.js';
import { criterionEdgesOf } from '../services/criterion-edges.js';
import {
  buildMissionDoneLeafIndex, findDuplicateDoneLeaf, missionOfEpic,
  type DoneLeafEntry, type DuplicateLeafMatch,
} from '../services/leaf-dup-guard.js';
import { runQuarantinedSpec } from '../services/quarantine-runner.js';
import { recordFinding, findByFailureIdentity, bumpRecurrence, type Finding } from '../services/finding-store.js';
import { validateExploreRequest, type ExploreVacuityWarning } from '../services/explore-request.js';
import { validateBugfixFiling, validateFeatureFiling, BugfixFilingRefusedError, FeatureFilingRefusedError } from '../services/typed-filing-request.js';
import type { BugfixSpec } from '../services/bugfix-spec.js';

function broadcastTodosUpdated(project: string, session: string): void {
  getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session });
}

/** Thrown by createEpicWithLandLeaf when a mission-homed epic declares no
 *  servesCriterionIds. SAME code as todo-store.ts's MissingCriterionEdgeError so
 *  callers branch identically — this is an earlier, additional check (at
 *  create-time, not approval-time), not a replacement. */
export class MissingServesCriterionError extends Error {
  readonly code = 'missing-criterion-edge';
  constructor(epicId: string, missionId: string) {
    super(
      `create_epic: a mission-homed epic must declare servesCriterionIds — epic ${epicId.slice(0, 8)} ` +
      `is homed to mission ${missionId.slice(0, 8)} but declares no servesCriterionIds (the epic→criterion edge). ` +
      `Pass servesCriterionIds when creating the epic.`,
    );
    this.name = 'MissingServesCriterionError';
  }
}

/** Thrown when a mission carries a cross-project `targetProject` that a homed epic
 *  (or the leaves under it) does not match — refusing to silently default leaves to
 *  the tracking project when the mission's implementation repo is elsewhere. */
export class MissingTargetProjectError extends Error {
  readonly code = 'missing-target-project';
  constructor(epicId: string, missionId: string, expectedTargetProject: string) {
    super(
      `epic ${epicId.slice(0, 8)} is homed to cross-project mission ${missionId.slice(0, 8)} which expects ` +
      `targetProject "${expectedTargetProject}", but the epic does not match it — leaves would otherwise be ` +
      `created against the tracking project instead of ${expectedTargetProject}.`,
    );
    this.name = 'MissingTargetProjectError';
  }
}

/** Thrown by addLeavesToEpic when a candidate leaf re-specifies work that is ALREADY DONE
 *  under the same mission (an accepted leaf, or any leaf of a landed epic). The planner
 *  prompt has carried a "DUP-CHECK BEFORE FILING" instruction for a while; a prohibition in
 *  a prompt is not a constraint, and mission a6ab522b (2026-07-24) re-filed two verbatim
 *  copies of landed epic d43c6386's leaves anyway — each costing a blueprint + implement
 *  node. This is the code that refuses it. The message names the prior leaf id/title and the
 *  epic that landed it so the conductor can accept-as-done or re-scope rather than guess. */
export class DuplicateOfDoneLeafError extends Error {
  readonly code = 'duplicate-of-done-leaf';
  constructor(readonly candidateTitle: string, readonly match: DuplicateLeafMatch) {
    super(
      `add_leaves: refusing leaf "${candidateTitle}" — it duplicates already-done work in the same mission: ` +
      `leaf ${match.leafId.slice(0, 8)} "${match.leafTitle}" (${match.reason}) under epic ` +
      `${match.epicId.slice(0, 8)} "${match.epicTitle}" (title similarity ${match.similarity.toFixed(2)}). ` +
      `Accept the criterion as already served, or re-scope this leaf to the residual work. ` +
      `If the re-do is deliberate, re-file the leaf with allowDuplicate:true.`,
    );
    this.name = 'DuplicateOfDoneLeafError';
  }
}

/** Thrown by fileExploreRequest when the oracle is empty or whitespace,
 *  before any bucket or leaf rows are written. */
export class ExploreOracleRefusedError extends Error {
  readonly code = 'explore-oracle-refused';
  constructor(refusal: string) {
    super(`file_explore: ${refusal}`);
    this.name = 'ExploreOracleRefusedError';
  }
}

/** Returns `err.code` for any typed workgraph error, else undefined. */
export function workgraphErrorCode(err: unknown): string | undefined {
  if (
    err instanceof MissingServesCriterionError
    || err instanceof MissingTargetProjectError
    || err instanceof DuplicateOfDoneLeafError
    || err instanceof ExploreOracleRefusedError
    || err instanceof BugfixFilingRefusedError
    || err instanceof FeatureFilingRefusedError
  ) {
    return err.code;
  }
  return undefined;
}

/** Compares two targetProject paths through the SAME normalisation createTodo funnels
 *  its inherited value through, so a raw string compare can't diverge on a worktree-shaped
 *  path. False when either side is nullish. */
function sameTarget(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return trackingProjectRoot(a) === trackingProjectRoot(b);
}

// ============= Shared plain functions (reused by MCP handlers + REST routes) =============

export interface CreateEpicOpts {
  title: string;
  /** Present-vs-absent matters: `homeProvided:false` (key omitted upstream) defers to the
   *  active mission; `homeProvided:true` with `home:null` forces a root epic; a non-empty
   *  string homes under that mission. */
  home?: string | null;
  homeProvided?: boolean;
  description?: string;
  servesCriterionIds?: string[];
  tier?: LeafTier;
  /** Opt-in only: when true, this epic's purpose is greening a red base lane. Disables
   *  the epic-base-red hold for this epic's leaves. Never auto-inferred from title. */
  baseRepair?: boolean;
}

/**
 * Create an EPIC row. Refuses bucket titles. The epic's terminal land is now
 * tracked via `epic.landedAt` (stamped on merge), not a minted `[LAND]` child
 * leaf — `checkLandDeps`/`missionLandLeafPromotion` derive land-readiness from
 * live sibling state and no longer require a land leaf to be present.
 */
export async function createEpicWithLandLeaf(
  project: string,
  session: string,
  opts: CreateEpicOpts,
): Promise<{ epic: Todo }> {
  const strippedTitle = stripLabel(opts.title);
  if (!strippedTitle) throw new Error('create_epic: title must be non-empty after stripping the role prefix');
  if (isBucketEpicTitle(strippedTitle)) {
    throw new Error('create_epic: bucket titles are refused — use file_bugfix/file_feature for quick-capture');
  }

  // Resolve `home` into the epic's missionId extra. Present-vs-absent is load-bearing:
  //   omitted           → omit missionId entirely (defers to resolveActiveMissionId).
  //   real JSON null     → missionId:null (a ROOT, no-mission epic).
  //   non-empty string   → missionId:<that mission id>.
  // A lossy MCP client that sends the literal 4-char string "null" (or any other
  // non-null/non-string shape) must NOT silently fall through to the active mission —
  // reject it loudly (this is the resolveTodoParent gotcha the task calls out: only a
  // strict `=== null` opts out, a string "null" gets mission-homed anyway).
  const epicExtras: NonNullable<Parameters<typeof addSessionTodo>[4]> = {
    kind: 'epic',
    assigneeSession: session,
    description: opts.description,
    servesCriterionIds: opts.servesCriterionIds,
    tier: opts.tier,
    baseRepair: opts.baseRepair ? 1 : 0,
  };
  if (opts.homeProvided) {
    if (opts.home === null) {
      epicExtras.missionId = null; // explicit root epic
    } else if (typeof opts.home === 'string' && opts.home.length > 0 && opts.home !== 'null') {
      epicExtras.missionId = opts.home; // explicit mission homing
    } else {
      // The literal 4-char string "null" (a lossy MCP client stringifying a real null)
      // must NOT fall through and get mission-homed — resolveTodoParent only opts out on
      // a strict `=== null`, so a stray "null" would otherwise home under the active
      // mission (or a mission literally named "null"). Reject it loudly.
      throw new Error(
        'create_epic: home must be a real JSON null, a mission id string, or omitted — the literal string "null" is not a valid opt-out',
      );
    }
  } // else: omit missionId key entirely → active-mission default

  let epic = await addSessionTodo(project, session, strippedTitle, undefined, epicExtras);

  // Serve-time criterion-edge guard: the epic's home is resolved INSIDE addSessionTodo →
  // resolveTodoParent → resolveActiveMissionId — reuse that resolution by inspecting the
  // just-created epic's parentId rather than re-implementing active-mission resolution here.
  const parent = epic.parentId ? getTodo(project, epic.parentId) : null;
  if (parent && isMission(parent)) {
    if ((opts.servesCriterionIds?.length ?? 0) === 0) {
      // Atomic-or-nothing: drop the just-created epic before throwing — no children
      // exist yet at this point, so this is a clean removal, not a cascade.
      await removeTodo(project, epic.id);
      throw new MissingServesCriterionError(epic.id, parent.id);
    }
    // Cross-project mission: the epic inherits the mission node's targetProject so the
    // worker cwds + gates in the implementation repo, not the tracking repo.
    if (parent.targetProject && parent.targetProject !== project) {
      await updateTodo(project, epic.id, { targetProject: parent.targetProject });
      epic = getTodo(project, epic.id)!;
    }
    // Belt-and-braces invariant: the inheritance above should always satisfy this, but
    // if the mission carries a genuinely cross-project targetProject and the epic still
    // doesn't match it, refuse rather than let leaves default to the tracking project.
    if (parent.targetProject && !sameTarget(parent.targetProject, project) && !sameTarget(epic.targetProject, parent.targetProject)) {
      await removeTodo(project, epic.id);
      throw new MissingTargetProjectError(epic.id, parent.id, parent.targetProject);
    }
  }

  return { epic };
}

export interface LeafInput {
  title: string;
  description?: string;
  type?: string;
  files?: string[];
  tier?: LeafTier;
  dependsOn?: string[];
  status?: TodoStatus;
  assigneeKind?: 'agent' | 'human';
  link?: TodoLink;
  /** Which mission acceptance criterion THIS leaf proves. Drives the proof-aware verify-flip
   *  (mission-store deriveCriterionAction): a landed epic only advertises a criterion as
   *  verify-ready if a delivered leaf tagged with it landed, so a dropped/orphaned proof leaf can
   *  no longer flip an unproven criterion. OPTIONAL — for a single-criterion epic the leaves
   *  auto-inherit the epic's one criterion; set this explicitly on a MULTI-criterion epic so each
   *  leaf names the criterion it proves. `servesCriterionIds` wins over the singular when both set. */
  servesCriterionId?: string;
  servesCriterionIds?: string[];
  /** ESCAPE HATCH for the duplicate-of-done guard below. A deliberate re-do (a landed change
   *  that regressed, a second pass over the same surface) is legitimate work, and the guard
   *  is a heuristic — an author who has looked at the prior leaf and still wants this one
   *  sets this to skip the check for THIS leaf only. */
  allowDuplicate?: boolean;
}

/**
 * Bulk-create leaf todos under an existing epic. Iterates `leaves` IN ORDER so an
 * entry's intra-batch positional `dependsOn` refs (`"$0"`, `"$1"`, …) resolve to the
 * id of an EARLIER-created sibling; a `$N` referencing a not-yet-created (forward) or
 * out-of-range index is rejected. Non-`$N` tokens are treated as literal existing
 * todo ids and passed through unchanged (cross-epic deps). Returns the created ids.
 */
export async function addLeavesToEpic(
  project: string,
  session: string,
  epicId: string,
  leaves: LeafInput[],
): Promise<{ epicId: string; createdIds: string[] }> {
  const parent = getTodo(project, epicId);
  if (!parent) throw new Error('add_leaves: no such epic ' + epicId);
  if (!isEpic(parent)) throw new Error('add_leaves: parentId must be an epic');
  if (parent.isBucket) {
    throw new Error('add_leaves: bucket epics are quick-capture only — use file_bugfix/file_feature, not add_leaves');
  }

  // Inherit the parent epic's targetProject onto every created leaf so leaves execute
  // against the same checkout as the epic. If the epic is mission-homed but its mission
  // node is unreadable, refuse rather than silently defaulting leaves to the tracking project.
  const epicTarget = parent.targetProject ?? null;
  // Proof-aware verify-flip: each leaf carries the criterion(s) it proves. An explicit per-leaf
  // tag wins; otherwise, when the epic serves exactly ONE criterion, its leaves auto-inherit it
  // (so the common one-epic-per-criterion case needs no authoring change). A multi-criterion epic
  // whose leaves aren't tagged falls through untagged — the mission-store flip then treats that
  // epic as legacy (trusts the epic edge) rather than wedging, and the /conductor skill instructs
  // authors to tag per-leaf in that case.
  const epicCriteria = criterionEdgesOf(parent);
  if (parent.parentId) {
    const epicMission = getTodo(project, parent.parentId);
    if (!epicMission) {
      throw new Error(
        `add_leaves: parent epic ${epicId.slice(0, 8)} is mission-homed but its mission node ` +
        `${parent.parentId.slice(0, 8)} is unreadable — refusing to default leaves to the tracking project`,
      );
    }
    if (isMission(epicMission) && epicMission.targetProject && !sameTarget(epicMission.targetProject, project)) {
      if (!sameTarget(parent.targetProject, epicMission.targetProject)) {
        throw new MissingTargetProjectError(epicId, epicMission.id, epicMission.targetProject);
      }
    }
  }

  // ---- Duplicate-of-done guard (incident: mission a6ab522b, 2026-07-24) ----
  // Scope is strictly the filing epic's OWN mission closure: a root/bucket-homed epic is
  // exempt entirely, a leaf under a different mission never refuses, and only accepted (or
  // landed-epic) prior leaves count. Built ONCE per call; FAILS OPEN — any throw while
  // scanning yields an empty index so a store hiccup can never block legitimate filing.
  const dupMissionId = missionOfEpic(parent, (id) => getTodo(project, id));
  let doneLeafIndex: DoneLeafEntry[] = [];
  if (dupMissionId) {
    try {
      doneLeafIndex = buildMissionDoneLeafIndex(project, dupMissionId);
    } catch {
      doneLeafIndex = [];
    }
  }

  const createdIds: string[] = [];
  for (const leaf of leaves) {
    if (doneLeafIndex.length > 0 && !leaf.allowDuplicate) {
      let match: DuplicateLeafMatch | null = null;
      try {
        match = findDuplicateDoneLeaf(doneLeafIndex, leaf.title);
      } catch {
        match = null; // FAIL OPEN — never block a filing on a guard-internal error.
      }
      // Thrown OUTSIDE the try so the refusal itself can never be swallowed by fail-open.
      if (match) throw new DuplicateOfDoneLeafError(leaf.title, match);
    }
    const resolvedDeps = (leaf.dependsOn ?? []).map((token) => {
      const m = /^\$(\d+)$/.exec(token);
      if (!m) return token; // literal existing todo id (cross-epic dep)
      const idx = Number(m[1]);
      if (idx < 0 || idx >= createdIds.length) {
        throw new Error(
          `add_leaves: dependsOn ref "${token}" is out of range — only earlier ($0..$${createdIds.length - 1}) intra-batch siblings can be referenced`,
        );
      }
      return createdIds[idx]!;
    });
    const leafOwn = criterionEdgesOf(leaf);
    const leafCriteria = leafOwn.length > 0 ? leafOwn : (epicCriteria.length === 1 ? epicCriteria : []);
    const created = await addSessionTodo(project, session, leaf.title, leaf.link, {
      kind: 'leaf',
      parentId: epicId,
      description: leaf.description,
      type: leaf.type,
      files: leaf.files,
      tier: leaf.tier,
      dependsOn: resolvedDeps,
      status: leaf.status,
      assigneeKind: leaf.assigneeKind,
      servesCriterionIds: leafCriteria.length > 0 ? leafCriteria : undefined,
    });
    createdIds.push(created.id);
    if (epicTarget) {
      await updateTodo(project, created.id, { targetProject: epicTarget });
    }
  }
  return { epicId, createdIds };
}

export interface FileToBucketOpts {
  title: string;
  bucket?: BucketType;
  description?: string;
  priority?: 0 | 1 | 2 | 3 | 4;
  status?: Extract<TodoStatus, 'backlog' | 'planned'>;
  link?: TodoLink;
  bugfixSpec?: BugfixSpec | null;
}

/**
 * Quick-capture a leaf under the Inbox (default), Bugfix inbox, or Feature requests bucket epic,
 * auto-creating the singleton bucket via ensureBucket. Only the bucket-relevant
 * statuses (backlog|planned) are exposed by the verb; defaults to 'backlog'.
 * Accepts any BucketType; defaults to 'inbox' when opts.bucket is absent/unknown.
 */
export async function fileToBucketLeaf(
  project: string,
  session: string,
  opts: FileToBucketOpts,
): Promise<Todo> {
  const bucketType: BucketType = (opts.bucket && ['bugfix', 'feature', 'explore'].includes(opts.bucket))
    ? opts.bucket
    : 'inbox';
  const parentId = await ensureBucket(project, bucketType);
  const leaf = await addSessionTodo(project, session, opts.title, opts.link, {
    kind: 'leaf',
    parentId,
    description: opts.description,
    priority: opts.priority,
    status: opts.status ?? 'backlog',
    bugfixSpec: opts.bugfixSpec ?? null,
  });

  // Post-condition: verify the bucket parent is not terminal after filing the leaf.
  // If a sweep-drop raced and already terminated the bucket, the leaf would have been
  // dropped too, leaving us with an orphan. Fail loudly rather than hand back a
  // success response for a leaf whose parent is dead.
  const parentNow = getTodo(project, parentId);
  if (parentNow && (parentNow.status === 'done' || parentNow.status === 'dropped')) {
    throw new Error(
      `fileToBucketLeaf: bucket parent ${parentId.slice(0, 8)} is terminal (${parentNow.status}) ` +
      `after leaf creation. The leaf was orphaned by a concurrent sweep-drop.`,
    );
  }

  return leaf;
}

export interface FileFindingOpts {
  violatedClaim: string;
  repro: string;
  implicatedFiles?: string[];
  ruledOut?: string[];
  surface?: string;
  title?: string;
  sourceLeafId?: string | null;
  reproCwd?: string;
}

/**
 * File a reproducible finding (a red quarantined spec) as a leaf under the Bugfix bucket epic.
 * Uses runQuarantinedSpec as a behavioural admission gate that must pass BEFORE either write.
 *
 * Gate order (mirrors runQuarantinedSpec's short-circuit result shape):
 * 1. repro is required (non-empty string)
 * 2. repro must have a __quarantine__ segment (quarantined check)
 * 3. repro must be committed to git (committed check)
 * 4. repro must run RED (red check)
 *
 * If failureIdentity is non-null and matches a prior finding, bumps its recurrence count
 * and returns the existing leaf/finding without writing new rows. Otherwise, after all
 * four gates pass: create the leaf under 'bugfix' bucket and record the finding.
 * Returns { leaf, finding, recurrence } where leaf is null only if the prior finding's
 * todo row was since removed.
 */
export async function fileFindingLeaf(
  project: string,
  session: string,
  opts: FileFindingOpts,
): Promise<{ leaf: Todo | null; finding: Finding; recurrence: boolean }> {
  // Gate 1: repro is required
  if (!opts.repro?.trim()) {
    throw new Error('fileFindingLeaf: repro is required');
  }

  // Gate 2-4: Run the quarantined spec
  const result = await runQuarantinedSpec(opts.reproCwd ?? project, opts.repro);

  // Gate 2: Check if quarantined
  if (!result.quarantined) {
    throw new Error(
      `fileFindingLeaf: repro has no __quarantine__ segment — ${opts.repro} is not a quarantined spec file`,
    );
  }

  // Gate 3: Check if committed
  if (!result.committed) {
    throw new Error(
      `fileFindingLeaf: repro is not committed to HEAD — ${opts.repro} must be checked into git before filing a finding`,
    );
  }

  // Gate 4: Check if red
  if (!result.red) {
    throw new Error(
      'fileFindingLeaf: repro runs GREEN — not a reproducible finding',
    );
  }

  // All gates passed. Check for recurrence: if failureIdentity is non-null and matches
  // a prior finding, bump its recurrence count and return early without creating rows.
  if (result.failureIdentity) {
    const priors = await findByFailureIdentity(project, result.failureIdentity);
    if (priors.length > 0) {
      const prior = priors[0]; // Most recent (ordered by createdAt DESC, rowid DESC)
      const now = new Date().toISOString();
      const bumped = await bumpRecurrence(project, prior.id, now);
      const leaf = getTodo(project, bumped.todoId) ?? null;
      return { leaf, finding: bumped, recurrence: true };
    }
  }

  // No prior match: create the leaf under 'bugfix' bucket
  const parentId = await ensureBucket(project, 'bugfix');
  const leaf = await addSessionTodo(project, session, opts.title ?? opts.violatedClaim.slice(0, 120), undefined, {
    kind: 'leaf',
    parentId,
    description: opts.violatedClaim,
    status: 'backlog',
  });

  // Record the finding in the findings store
  const finding = await recordFinding(project, {
    todoId: leaf.id,
    violatedClaim: opts.violatedClaim,
    implicatedFiles: opts.implicatedFiles,
    ruledOut: opts.ruledOut,
    reproPath: opts.repro,
    failureIdentity: result.failureIdentity,
    surface: opts.surface,
    sourceLeafId: opts.sourceLeafId ?? null,
  });

  return { leaf, finding, recurrence: false };
}

export interface FileExploreOpts {
  scope: string;
  target: string;
  oracle: string;
  not?: string;
  reach?: string;
  title?: string;
  description?: string;
  status?: Extract<TodoStatus, 'backlog' | 'planned' | 'ready'>;
}

export async function fileExploreRequest(
  project: string,
  session: string,
  opts: FileExploreOpts,
): Promise<{ leaf: Todo; warnings: ExploreVacuityWarning[] }> {
  const { refusal, warnings } = validateExploreRequest({ oracle: opts.oracle, scope: opts.scope, target: opts.target });
  if (refusal !== null) throw new ExploreOracleRefusedError(refusal);

  const parentId = await ensureExploreRunEpic(project);
  const leaf = await addSessionTodo(project, session, opts.title ?? opts.oracle, undefined, {
    kind: 'leaf',
    parentId,
    type: 'explore',
    description: opts.description,
    status: opts.status ?? 'ready',
    exploreSpec: { scope: opts.scope, target: opts.target, oracle: opts.oracle, not: opts.not ?? null, reach: opts.reach ?? null },
  });

  return { leaf, warnings };
}

// ============= Tool definitions =============

export const WORKGRAPH_TOOL_DEFS = [
  {
    name: 'create_epic',
    description:
      "Create an EPIC row. A non-bucket epic's terminal land is tracked via the epic's `landedAt` field (stamped on merge into master), derived from live sibling build-child state — no `[LAND]` child leaf is minted. Refuses bucket titles (Inbox/Bugfix inbox/Feature requests — those are quick-capture only, created via file_bugfix/file_feature). `home` is the epic's parent: omit for the caller's active mission, pass a mission id to home explicitly, or pass the JSON literal null to create a ROOT epic with no mission parent. Returns {epicId, epic} (epic is the derived todo view).",
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        session: { type: 'string' },
        title: { type: 'string' },
        home: { type: ['string', 'null'], description: 'Mission id to home under, or null for a root (no-mission) epic. Omit to use the active mission.' },
        servesCriterionIds: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        tier: { type: 'string', enum: ['full', 'small', 'test-pinned'] },
        baseRepair: { type: 'boolean', description: 'Opt-in only, for an epic whose purpose is greening a red base lane. When true, disables the epic-base-red hold (G2) for this epic\'s leaves, allowing each leaf\'s gate to judge net-new-vs-base (crit-8 lazy baseline). Never auto-inferred from title or description.' },
      },
      required: ['project', 'session', 'title'],
    },
  },
  {
    name: 'add_leaves',
    description:
      "The SOLE public leaf-creation verb — bulk-add leaf todos under an existing epic (not a bucket, not a mission). `leaves` entries may reference EARLIER entries in the same batch via dependsOn:['$0','$1',...] (0-indexed positional refs), or existing todo ids for cross-epic dependencies. Pass status:'ready' on an entry to approve it at creation (skips the planned→ready promotion step). WITHOUT it a leaf is created UNAPPROVED and stays that way — it is never auto-promoted, so it sits unclaimable indefinitely while planner-created siblings in the same epic run. That is deliberate (a hand-filed leaf should be approved on purpose), but it means a watcher intervention filed without status:'ready' is silently inert. ENFORCED DUP-CHECK: filing a leaf whose title matches an already-DONE leaf (accepted, or under a landed epic) in the SAME mission is refused with error code `duplicate-of-done-leaf`, naming the prior leaf and its epic — accept the criterion as served or re-scope, or pass allowDuplicate:true on that entry for a deliberate re-do.",
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        session: { type: 'string' },
        epicId: { type: 'string' },
        leaves: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              type: { type: 'string' },
              files: { type: 'array', items: { type: 'string' }, description: 'Touched files — persisted as `declaredFiles` and used to infer the agent-profile type when `type` is omitted, and for dispatch same-file serialization.' },
              tier: { type: 'string', enum: ['full', 'small', 'test-pinned'] },
              dependsOn: { type: 'array', items: { type: 'string' } },
              status: { type: 'string', enum: ['planned', 'ready'] },
              assigneeKind: { type: 'string', enum: ['agent', 'human'] },
              link: { type: 'object' },
              servesCriterionId: { type: 'string', description: 'The mission criterion THIS leaf proves. Auto-inherited from the epic when the epic serves exactly ONE criterion; set it explicitly on a MULTI-criterion epic so the proof-aware verify-flip knows which criterion each leaf proves (a criterion is only advertised verify-ready once a delivered leaf tagged with it lands).' },
              servesCriterionIds: { type: 'array', items: { type: 'string' }, description: 'The mission criteria THIS leaf proves (wins over servesCriterionId). Use when one leaf proves several aspect criteria.' },
              allowDuplicate: { type: 'boolean', description: 'Skip the duplicate-of-done check for THIS leaf — for a deliberate re-do of already-landed work.' },
            },
            required: ['title'],
          },
        },
      },
      required: ['project', 'session', 'epicId', 'leaves'],
    },
  },
  {
    name: 'file_finding',
    description:
      "File a reproducible finding from a red quarantined spec. Creates a leaf under the Bugfix bucket epic and persists typed metadata (violated claim, implicated files, ruled-out paths, failure identity) for dedup and recurrence tracking. Refuses if repro is missing, uncommitted, has no __quarantine__ segment, or runs green. A second filing against the same failureIdentity does not create a new leaf or finding row — it bumps recurrenceCount on the existing finding and returns the existing leaf with recurrence:true in the response.",
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        session: { type: 'string' },
        violatedClaim: { type: 'string' },
        repro: { type: 'string', description: 'Path to a committed quarantined spec file (must contain __quarantine__ in the path and be red at HEAD).' },
        implicatedFiles: { type: 'array', items: { type: 'string' }, description: 'Files involved in the failing test.' },
        ruledOut: { type: 'array', items: { type: 'string' }, description: 'Files checked but found not to be the cause.' },
        surface: { type: 'string', description: 'Where the failure manifests (e.g., "ui", "backend", "integration").' },
        title: { type: 'string', description: 'Leaf title (defaults to first 120 chars of violatedClaim).' },
        sourceLeafId: { type: 'string', description: 'The leaf todo id (e.g. an explore leaf) that observed this finding.' },
        reproCwd: { type: 'string', description: 'Working tree to run the repro gate from, when it differs from `project` — e.g. an explore leaf\'s own worktree whose commits are not yet in `project`\'s checkout.' },
      },
      required: ['project', 'session', 'violatedClaim', 'repro'],
    },
  },
  {
    name: 'file_explore',
    description:
      "File an explore-node investigation request as a leaf under the rolling 'Explore runs' epic. The leaf is dispatchable immediately (no re-homing required). `oracle` is the falsifiable claim the explore node tests — it is validated up front and REFUSED (zero rows written, error code explore-oracle-refused) if empty. A syntactically-present oracle is never refused but rides back non-fatal `warnings` for up to three vacuity tells: no-named-anchor (no identifier/path:line/hash reference), oracle-subsumed-by-scope (adds no tokens beyond scope+target), no-falsifiable-predicate (no must/never/always/equals/... assertion word).",
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        session: { type: 'string' },
        scope: { type: 'string' },
        target: { type: 'string' },
        oracle: { type: 'string' },
        not: { type: 'string' },
        reach: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['backlog', 'planned', 'ready'], description: "Leaf status: 'backlog' (unplanned), 'planned' (planned but unapproved), or 'ready' (approved, dispatchable — default)." },
      },
      required: ['project', 'session', 'scope', 'target', 'oracle'],
    },
  },
  {
    name: 'inspect_workgraph',
    description: 'READ-ONLY. Returns structured workgraph-health rows (epicChildCounts, orphanLeaves, terminalEpicsWithOpenChildren) for `project`, optionally scoped to one epic via `epicId`. Never returns prose, never mutates.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        epicId: { type: 'string', description: 'Optional — scope the report to this one epic (its own row plus any of its direct children that are orphans/open).' },
      },
      required: ['project'],
    },
  },
  {
    name: 'file_bugfix',
    description:
      'File a typed bugfix report. Creates a leaf under the Bugfix bucket epic (auto-created if missing) with structured metadata (observed failure, evidence anchor, fixed means). Required fields: project, session, observedFailure, evidence, fixedMeans. The validator refuses filings with codes no-failure-shape (observedFailure lacks failure keywords), no-named-anchor (evidence has no path:line or identifier), or no-falsifiable-predicate (fixedMeans lacks measurable assertion). A refusal writes ZERO rows and returns error code bugfix-filing-refused.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        session: { type: 'string' },
        observedFailure: { type: 'string', description: 'Description of the concrete symptom or error observed.' },
        evidence: { type: 'string', description: 'Grounding anchor: a file path:line, identifier, or hash reference.' },
        fixedMeans: { type: 'string', description: 'Measurable assertion of what was fixed.' },
        title: { type: 'string', description: 'Leaf title (defaults to observedFailure).' },
        description: { type: 'string' },
      },
      required: ['project', 'session', 'observedFailure', 'evidence', 'fixedMeans'],
    },
  },
  {
    name: 'file_feature',
    description:
      'File a typed feature request. Creates a leaf under the Feature requests bucket epic (auto-created if missing) with a user-visible outcome statement. Required fields: project, session, outcome. The validator refuses filings with code no-user-visible-outcome (outcome lacks both a surface term and an action verb). A refusal writes ZERO rows and returns error code feature-filing-refused.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        session: { type: 'string' },
        outcome: { type: 'string', description: 'What the user can now see or do (must name a surface like "operator", "card", "panel" and an action like "sees", "shows", "displays").' },
        title: { type: 'string', description: 'Leaf title (defaults to outcome).' },
        description: { type: 'string' },
      },
      required: ['project', 'session', 'outcome'],
    },
  },
];

/**
 * MCP transports only carry the thrown message, not the Error instance/code — re-throw
 * the SAME instance with its message prefixed `[<code>] ` (once) so in-process callers
 * still see `.code` while MCP clients can pattern-match the prefix.
 */
async function withWorkgraphErrorCode<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = workgraphErrorCode(err);
    if (code && err instanceof Error && !err.message.startsWith(`[${code}] `)) {
      err.message = `[${code}] ${err.message}`;
    }
    throw err;
  }
}

/**
 * Handle a work-graph-group CallTool invocation. Returns the JSON string result, or
 * `null` if `name` is not a work-graph tool — in which case the caller falls through
 * to its own switch (mirrors handleMissionTool's dispatch contract).
 */
export async function handleWorkgraphTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'create_epic': {
      const { project, session, title } = args as { project: string; session: string; title: string };
      if (!project || !session || !title) throw new Error('Missing required: project, session, title');
      const { epic } = await withWorkgraphErrorCode(() => createEpicWithLandLeaf(project, session, {
        title,
        home: args.home,
        homeProvided: 'home' in args,
        description: args.description,
        servesCriterionIds: args.servesCriterionIds,
        tier: args.tier,
        baseRepair: args.baseRepair,
      }));
      broadcastTodosUpdated(project, session);
      return JSON.stringify(
        { epicId: epic.id, epic: deriveTodoViews(project, [epic])[0] },
        null,
        2,
      );
    }
    case 'add_leaves': {
      const { project, session, epicId, leaves } = args as { project: string; session: string; epicId: string; leaves: LeafInput[] };
      if (!project || !session || !epicId) throw new Error('Missing required: project, session, epicId');
      if (!Array.isArray(leaves) || leaves.length === 0) throw new Error('add_leaves: leaves must be a non-empty array');
      const { createdIds } = await withWorkgraphErrorCode(() => addLeavesToEpic(project, session, epicId, leaves));
      broadcastTodosUpdated(project, session);
      return JSON.stringify(
        { epicId, createdIds, leaves: deriveTodoViews(project, createdIds.map((id) => getTodo(project, id)!)) },
        null,
        2,
      );
    }
    case 'file_finding': {
      const { project, session, violatedClaim, repro } = args as { project: string; session: string; violatedClaim: string; repro: string };
      if (!project || !session || violatedClaim === undefined || repro === undefined) throw new Error('Missing required: project, session, violatedClaim, repro');
      const { leaf, finding, recurrence } = await fileFindingLeaf(project, session, {
        violatedClaim,
        repro,
        implicatedFiles: args.implicatedFiles,
        ruledOut: args.ruledOut,
        surface: args.surface,
        title: args.title,
        sourceLeafId: args.sourceLeafId,
        reproCwd: args.reproCwd,
      });
      broadcastTodosUpdated(project, session);
      return JSON.stringify({ leaf: leaf ? deriveTodoViews(project, [leaf])[0] : null, finding, recurrence }, null, 2);
    }
    case 'file_explore': {
      const { project, session, scope, target, oracle } = args as { project: string; session: string; scope: string; target: string; oracle: string };
      if (!project || !session || !scope || !target || !oracle) throw new Error('Missing required: project, session, scope, target, oracle');
      const { leaf, warnings } = await withWorkgraphErrorCode(() => fileExploreRequest(project, session, {
        scope, target, oracle,
        not: args.not,
        reach: args.reach,
        title: args.title,
        description: args.description,
        status: args.status,
      }));
      broadcastTodosUpdated(project, session);
      return JSON.stringify({ leaf: deriveTodoViews(project, [leaf])[0], warnings }, null, 2);
    }
    case 'file_bugfix': {
      const { project, session, observedFailure, evidence, fixedMeans } = args as { project: string; session: string; observedFailure: string; evidence: string; fixedMeans: string };
      if (!project || !session || !observedFailure || !evidence || !fixedMeans) throw new Error('Missing required: project, session, observedFailure, evidence, fixedMeans');
      const { refusal, warnings } = validateBugfixFiling({ observedFailure, evidence, fixedMeans, title: args.title, description: args.description });
      if (refusal !== null) {
        await withWorkgraphErrorCode(() => {
          throw new BugfixFilingRefusedError(refusal);
        });
      }
      const leaf = await fileToBucketLeaf(project, session, {
        title: args.title ?? observedFailure,
        bucket: 'bugfix',
        description: args.description ?? `Failure: ${observedFailure}\nEvidence: ${evidence}\nFixed: ${fixedMeans}`,
        bugfixSpec: { observedFailure, evidence, fixedMeans },
      });
      broadcastTodosUpdated(project, session);
      return JSON.stringify({ leaf: deriveTodoViews(project, [leaf])[0], warnings }, null, 2);
    }
    case 'file_feature': {
      const { project, session, outcome } = args as { project: string; session: string; outcome: string };
      if (!project || !session || !outcome) throw new Error('Missing required: project, session, outcome');
      const { refusal, warnings } = validateFeatureFiling({ outcome, title: args.title, description: args.description });
      if (refusal !== null) {
        await withWorkgraphErrorCode(() => {
          throw new FeatureFilingRefusedError(refusal);
        });
      }
      const leaf = await fileToBucketLeaf(project, session, {
        title: args.title ?? outcome,
        bucket: 'feature',
        description: args.description,
      });
      broadcastTodosUpdated(project, session);
      return JSON.stringify({ leaf: deriveTodoViews(project, [leaf])[0], warnings }, null, 2);
    }
    case 'inspect_workgraph': {
      const { project, epicId } = args as { project: string; epicId?: string };
      if (!project) throw new Error('Missing required: project');
      const todos = listTodos(project, { includeCompleted: true });
      const health = computeWorkgraphHealth(todos);

      let epicChildCounts = health.epicChildCounts;
      let orphanLeaves = health.orphanLeaves;
      let terminalEpicsWithOpenChildren = health.terminalEpicsWithOpenChildren;

      if (epicId) {
        epicChildCounts = epicChildCounts.filter((row) => row.epicId === epicId);
        orphanLeaves = orphanLeaves.filter((row) => {
          const leaf = todos.find((t) => t.id === row.todoId);
          return leaf?.parentId === epicId;
        });
        terminalEpicsWithOpenChildren = terminalEpicsWithOpenChildren.filter((row) => row.epicId === epicId);
      }

      return JSON.stringify(
        {
          project,
          epicChildCounts,
          orphanLeaves,
          terminalEpicsWithOpenChildren,
          counts: {
            orphanLeaves: orphanLeaves.length,
            terminalEpicsWithOpenChildren: terminalEpicsWithOpenChildren.length,
          },
        },
        null,
        2,
      );
    }
    default:
      return null;
  }
}
