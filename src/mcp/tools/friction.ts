/**
 * Friction-signal MCP tools (SEAM·collab). Workers emit a structured friction
 * note on a failed/retried attempt; the supervisor + DETECT/DRAFT query them.
 * Thin wrappers over services/friction-store.ts.
 */
import {
  recordFriction,
  listFriction,
  type FrictionLayer,
  type FrictionNote,
} from '../../services/friction-store.js';

export const recordFrictionSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    todoId: { type: 'string', description: 'The work-graph todo this attempt was against' },
    layer: {
      type: 'string',
      enum: ['orchestration', 'domain'],
      description: 'Where the friction came from: orchestration (collab harness — gate format, wrong test cmd, profile/tooling) vs domain (the project code/API the worker was editing)',
    },
    retryReason: { type: 'string', description: 'Short reason tag, e.g. "gate-format", "wrong-test-cmd", "cad-api-rederived", "missing-domain-model"' },
    session: { type: 'string', description: 'Worker/pool session that emitted it (optional)' },
    attempt: { type: 'number', description: '1-based attempt number — the worker\'s own count, not the lease retryCount (optional, default 1)' },
    detail: { type: 'string', description: 'Optional free-text elaboration' },
  },
  required: ['project', 'todoId', 'layer', 'retryReason'],
};

export const listFrictionSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    todoId: { type: 'string', description: 'Filter to one todo (optional)' },
    session: { type: 'string', description: 'Filter to one session (optional)' },
    layer: {
      type: 'string',
      enum: ['orchestration', 'domain'],
      description: 'Filter by layer, e.g. "domain" to answer "which todos hit domain-layer friction and why" (optional)',
    },
  },
  required: ['project'],
};

export async function recordFrictionTool(args: {
  project: string;
  todoId: string;
  layer: FrictionLayer;
  retryReason: string;
  session?: string;
  attempt?: number;
  detail?: string;
}): Promise<{ success: true; note: FrictionNote }> {
  const note = await recordFriction(args.project, {
    todoId: args.todoId,
    layer: args.layer,
    retryReason: args.retryReason,
    session: args.session ?? null,
    attempt: args.attempt,
    detail: args.detail ?? null,
  });
  return { success: true, note };
}

export function listFrictionTool(args: {
  project: string;
  todoId?: string;
  session?: string;
  layer?: FrictionLayer;
}): { notes: FrictionNote[]; count: number } {
  const notes = listFriction(args.project, {
    todoId: args.todoId,
    session: args.session,
    layer: args.layer,
  });
  return { notes, count: notes.length };
}
