import type { Todo } from '../../todo-store';
import type { TodoKind } from '../../todo-kind';

/** Every non-`kind` field of `Todo`, at its inert default. Not exported. */
function base(): Omit<Todo, 'kind'> {
  return {
    id: 'id',
    ownerSession: 's',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: 't',
    description: null,
    status: 'planned',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    claim: null,
    approvedAt: null,
    approvedBy: null,
    heldAt: null,
    heldReason: null,
    retryCount: 0,
    completedBy: null,
    objectRef: null,
    decisionRef: null,
    claimProbe: null,
    inheritedBlueprintFrom: null,
    inheritedFiles: [],
  };
}

/** Build a Todo fixture. `kind` is REQUIRED and has NO default: a missing kind is a
 *  producer bug (todo-kind.ts), and a defaulting factory would re-hide it. */
export function mkTodo(over: Partial<Todo> & { kind: TodoKind }): Todo {
  return { ...base(), ...over };
}

/** A PRE-BACKFILL legacy row: `kind` is genuinely NULL. The ONLY way to build one.
 *  Any predicate reading it MUST throw MissingKindError — assert that, never paper over it. */
export function mkLegacyTodo(over: Partial<Todo> = {}): Todo {
  return { ...base(), kind: null, ...over };
}
