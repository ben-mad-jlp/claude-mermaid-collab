/**
 * settle_dup_of_landed — MCP wiring for the dep-settlement primitives
 * (settleDupOfLanded + repointDependents in src/services/dep-settlement.ts).
 *
 * One call settles a leaf that is a duplicate of already-landed work (done+accepted
 * with a `dup-of-landed:<sha8>` provenance handle) and, with repoint:true, moves its
 * dependents onto the landed leaf — the mechanical replacement for the manual-hold +
 * override_accept_todo workaround from the 2a58bf13 incident.
 */
import { settleDupOfLanded, repointDependents } from '../../services/dep-settlement.js';
import { getWebSocketHandler } from '../../services/ws-handler-manager.js';

export const settleDupOfLandedToolDef = {
  name: 'settle_dup_of_landed',
  description: "One call settles a dup of already-landed work: marks the todo done+accepted with a `dup-of-landed:<sha8>` provenance handle and, with repoint:true, moves its dependents onto the landed leaf in the same call — the mechanical replacement for the manual-hold + override_accept_todo workaround.",
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Tracking project (where the work-graph lives).' },
      todoId: { type: 'string', description: 'The duplicate todo id to settle.' },
      landedCommit: { type: 'string', description: 'The sha of the already-landed commit this todo duplicates.' },
      landedTodoId: { type: 'string', description: 'Optional: the todo id of the already-landed leaf, folded into the provenance handle and used as the repoint target.' },
      repoint: { type: 'boolean', description: "When true, move every dependent's dependsOn edge from todoId onto landedTodoId (or drop the edge when landedTodoId is omitted) BEFORE settling the dup." },
    },
    required: ['project', 'todoId', 'landedCommit'],
  },
};

export async function settleDupOfLandedHandler(args: any): Promise<string> {
  const { project, todoId, landedCommit, landedTodoId, repoint } = args as {
    project: string;
    todoId: string;
    landedCommit: string;
    landedTodoId?: string;
    repoint?: boolean;
  };
  if (!project || !todoId || !landedCommit) {
    throw new Error('Missing required: project, todoId, landedCommit');
  }

  const actor = 'mcp:settle_dup_of_landed';
  const reason = 'dup-of-landed';

  let affected: string[] = [];
  if (repoint) {
    ({ affected } = repointDependents(project, todoId, landedTodoId ?? null, { actor, reason }));
  }

  const settled = await settleDupOfLanded(project, todoId, { landedCommit, landedTodoId, actor, reason });

  getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });

  return JSON.stringify({ settled: settled.todoId, dependents: affected }, null, 2);
}
