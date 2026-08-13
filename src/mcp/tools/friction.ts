/**
 * Friction-signal MCP tools (SEAM·collab). Workers emit a structured friction
 * note on a failed/retried attempt; the supervisor + DETECT/DRAFT query them.
 * Thin wrappers over services/friction-store.ts.
 */
import {
  recordFriction,
  recordFrictionWithRecurrence,
  listFriction,
  countFriction,
  type FrictionLayer,
  type FrictionNote, retractFriction } from '../../services/friction-store.js';

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

export const recordFrictionSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    todoId: { type: 'string', description: 'The work-graph todo this attempt was against (optional for operational notes not scoped to a single leaf)' },
    layer: {
      type: 'string',
      enum: ['orchestration', 'domain', 'operational'],
      description: 'Where the friction came from: orchestration (collab harness — gate format, wrong test cmd, profile/tooling), domain (the project code/API the worker was editing), or operational (systemic/dogfood friction any agent can emit without a leaf scope)',
    },
    retryReason: { type: 'string', description: 'Short reason tag, e.g. "gate-format", "wrong-test-cmd", "cad-api-rederived", "missing-domain-model"' },
    session: { type: 'string', description: 'Worker/pool session that emitted it (optional)' },
    attempt: { type: 'number', description: '1-based attempt number — the worker\'s own count, not the lease retryCount (optional, default 1)' },
    detail: { type: 'string', description: 'Optional free-text elaboration' },
  },
  required: ['project', 'layer', 'retryReason'],
};

export const listFrictionSchema = {
  type: 'object',
  properties: {
    layer: {
      type: 'string',
      enum: ['orchestration', 'domain', 'operational'],
      description: 'Filter by layer, e.g. "domain" to answer "which todos hit domain-layer friction and why" (optional)',
    },
    limit: { type: 'number', description: 'Maximum number of notes to return (default 100, max 500)' },
    offset: { type: 'number', description: 'Offset into result set (default 0)' },
    project: { type: 'string', description: 'Absolute path to project root' },
    retryReason: { type: 'string', description: 'Filter by retry reason (exact match, optional)' },
    session: { type: 'string', description: 'Filter to one session (optional)' },
    since: { type: 'string', description: 'ISO-8601 timestamp: include notes created at or after this time (optional)' },
    todoId: { type: 'string', description: 'Filter to one todo (optional)' },
  },
  required: ['project'],
};

export async function recordFrictionTool(args: {
  project: string;
  todoId?: string;
  layer: FrictionLayer;
  retryReason: string;
  session?: string;
  attempt?: number;
  detail?: string;
}): Promise<{ success: true; note: FrictionNote; signature: string; priorCount: number; priorNoteIds: string[] }> {
  const { note, signature, priorCount, priorNoteIds } = await recordFrictionWithRecurrence(args.project, {
    todoId: args.todoId ?? null,
    layer: args.layer,
    retryReason: args.retryReason,
    session: args.session ?? null,
    attempt: args.attempt,
    detail: args.detail ?? null,
  });
  return { success: true, note, signature, priorCount, priorNoteIds };
}

export function listFrictionTool(args: {
  project: string;
  todoId?: string;
  session?: string;
  layer?: FrictionLayer;
  includeRetracted?: boolean;
  limit?: number;
  offset?: number;
  since?: string;
  retryReason?: string;
}): { notes: FrictionNote[]; count: number; total: number; limit: number; offset: number; hasMore: boolean } {
  const limit = Math.min(Math.max(1, Number(args.limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const offset = Math.max(0, Number(args.offset) || 0);

  const filter = {
    todoId: args.todoId,
    session: args.session,
    layer: args.layer,
    includeRetracted: args.includeRetracted,
    retryReason: args.retryReason,
    since: args.since,
    limit,
    offset,
  };

  const notes = listFriction(args.project, filter);
  const total = countFriction(args.project, {
    todoId: args.todoId,
    session: args.session,
    layer: args.layer,
    includeRetracted: args.includeRetracted,
    retryReason: args.retryReason,
    since: args.since,
  });

  return {
    notes,
    count: notes.length,
    total,
    limit,
    offset,
    hasMore: offset + notes.length < total,
  };
}

export const reportDogfoodSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    reason: { type: 'string', description: 'Short reason tag for the systemic dogfood friction, e.g. "tmux-pane-leak", "stale-shadow-server", "nudge-not-delivered"' },
    detail: { type: 'string', description: 'Optional free-text elaboration' },
    todoId: { type: 'string', description: 'Optional work-graph todo this friction relates to (operational notes are usually NOT leaf-scoped)' },
  },
  required: ['project', 'reason'],
};

export async function reportDogfoodTool(args: {
  project: string;
  reason: string;
  detail?: string;
  todoId?: string;
}): Promise<{ success: true; note: FrictionNote }> {
  const note = await recordFriction(args.project, {
    todoId: args.todoId ?? null,
    layer: 'operational',
    retryReason: args.reason,
    detail: args.detail ?? null,
  });
  return { success: true, note };
}

/** RETRACT a friction note whose analysis was wrong. Thin wrapper over the store, which throws
 *  on an unknown id rather than reporting a zero-row success. */
export function retractFrictionTool(args: {
  project: string;
  id: string;
  reason: string;
  supersededBy?: string;
}): { note: FrictionNote } {
  const note = retractFriction(args.project, {
    id: args.id,
    reason: args.reason,
    supersededBy: args.supersededBy,
  });
  return { note };
}
