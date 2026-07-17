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
import { getTodo, deriveTodoViews, isBucketEpicTitle, type Todo, type TodoStatus, type TodoLink, type LeafTier } from '../services/todo-store.js';
import { isEpic, stripLabel } from '../services/todo-kind.js';
import { ensureBucket, type BucketType } from '../services/bucket-registry.js';
import { addSessionTodo } from './tools/session-todos.js';

function broadcastTodosUpdated(project: string, session: string): void {
  getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session });
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
    throw new Error('create_epic: bucket titles are refused — use file_to_bucket for Inbox/Bugfix inbox');
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

  const epic = await addSessionTodo(project, session, strippedTitle, undefined, epicExtras);
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
    throw new Error('add_leaves: bucket epics are quick-capture only — use file_to_bucket, not add_leaves');
  }

  const createdIds: string[] = [];
  for (const leaf of leaves) {
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
    });
    createdIds.push(created.id);
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
}

/**
 * Quick-capture a leaf under the Inbox (default) or Bugfix inbox bucket epic,
 * auto-creating the singleton bucket via ensureBucket. Only the two bucket-relevant
 * statuses (backlog|planned) are exposed by the verb; defaults to 'backlog'.
 */
export async function fileToBucketLeaf(
  project: string,
  session: string,
  opts: FileToBucketOpts,
): Promise<Todo> {
  const bucketType: BucketType = opts.bucket === 'bugfix' ? 'bugfix' : 'inbox';
  const parentId = await ensureBucket(project, bucketType);
  return addSessionTodo(project, session, opts.title, opts.link, {
    kind: 'leaf',
    parentId,
    description: opts.description,
    priority: opts.priority,
    status: opts.status ?? 'backlog',
  });
}

// ============= Tool definitions =============

export const WORKGRAPH_TOOL_DEFS = [
  {
    name: 'create_epic',
    description:
      "Atomically create an EPIC plus its terminal [LAND]→master leaf (kind='land', assigneeKind='human'). Every non-bucket epic gets a land leaf — including root-homed epics with no mission. Refuses bucket titles (Inbox/Bugfix inbox — those are quick-capture only, created via file_to_bucket). `home` is the epic's parent: omit for the caller's active mission, pass a mission id to home explicitly, or pass the JSON literal null to create a ROOT epic with no mission parent. Returns {epicId, landLeafId}.",
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
      },
      required: ['project', 'session', 'title'],
    },
  },
  {
    name: 'add_leaves',
    description:
      "The SOLE public leaf-creation verb — bulk-add leaf todos under an existing epic (not a bucket, not a mission). `leaves` entries may reference EARLIER entries in the same batch via dependsOn:['$0','$1',...] (0-indexed positional refs), or existing todo ids for cross-epic dependencies. Pass status:'ready' on an entry to approve it at creation (skips the planned→ready promotion step).",
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
              files: { type: 'array', items: { type: 'string' } },
              tier: { type: 'string', enum: ['full', 'small', 'test-pinned'] },
              dependsOn: { type: 'array', items: { type: 'string' } },
              status: { type: 'string', enum: ['planned', 'ready'] },
              assigneeKind: { type: 'string', enum: ['agent', 'human'] },
              link: { type: 'object' },
            },
            required: ['title'],
          },
        },
      },
      required: ['project', 'session', 'epicId', 'leaves'],
    },
  },
  {
    name: 'file_to_bucket',
    description:
      "Quick-capture: file a leaf under the Inbox or Bugfix inbox bucket epic (auto-created if missing). For unplanned thoughts/bugs that don't yet warrant a full epic — re-home later via promote_to_epic.",
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        session: { type: 'string' },
        title: { type: 'string' },
        bucket: { type: 'string', enum: ['inbox', 'bugfix'] },
        description: { type: 'string' },
        priority: { type: 'number', enum: [0, 1, 2, 3, 4] },
        status: { type: 'string', enum: ['backlog', 'planned'] },
        link: { type: 'object', properties: { blueprintId: { type: 'string' } } },
      },
      required: ['project', 'session', 'title'],
    },
  },
];

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
      const { epic } = await createEpicWithLandLeaf(project, session, {
        title,
        home: args.home,
        homeProvided: 'home' in args,
        description: args.description,
        servesCriterionIds: args.servesCriterionIds,
        tier: args.tier,
      });
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
      const { createdIds } = await addLeavesToEpic(project, session, epicId, leaves);
      broadcastTodosUpdated(project, session);
      return JSON.stringify(
        { epicId, createdIds, leaves: deriveTodoViews(project, createdIds.map((id) => getTodo(project, id)!)) },
        null,
        2,
      );
    }
    case 'file_to_bucket': {
      const { project, session, title } = args as { project: string; session: string; title: string };
      if (!project || !session || !title) throw new Error('Missing required: project, session, title');
      const created = await fileToBucketLeaf(project, session, {
        title,
        bucket: args.bucket,
        description: args.description,
        priority: args.priority,
        status: args.status,
        link: args.link,
      });
      broadcastTodosUpdated(project, session);
      return JSON.stringify({ leaf: deriveTodoViews(project, [created])[0] }, null, 2);
    }
    default:
      return null;
  }
}
