import type { TodoKind } from './claimability.ts';

export type { TodoKind };

/** The minimum a caller must supply. Structural so BOTH the server `Todo`
 *  (todo-store.ts) and the UI `SessionTodo` (ui/src/types/sessionTodo.ts) satisfy
 *  it without either side importing the other's aggregate.
 *
 *  Role is the `kind` column. Neither a title nor the presence of children is
 *  ever consulted — a leaf with children is a leaf; an epic with no children is
 *  an epic. */
export interface KindBearing {
  kind?: TodoKind | null;
  title?: string | null;
  /** Bucket-ness is a per-todo marker ORTHOGONAL to `kind`; predicates in
   *  mission-parenting/land-authority read it to exclude bucket epics
   *  (Inbox, Bugfix inbox) from convergence work and mission parenting. */
  isBucket?: boolean;
}

const KINDS = ['mission', 'epic', 'land', 'leaf', 'gate'] as const;
const isTodoKind = (v: unknown): v is TodoKind =>
  typeof v === 'string' && (KINDS as readonly string[]).includes(v);

export class MissingKindError extends Error {
  constructor(t: KindBearing | null | undefined) {
    super(
      `todo-kind: kindOf() received a payload with no valid \`kind\` ` +
        `(got ${JSON.stringify(t?.kind)}, title ${JSON.stringify(t?.title ?? null)}). ` +
        `\`kind\` is a required column since stage C; a missing kind is a bug at the ` +
        `producer, not a default. Never infer a role from a title.`,
    );
    this.name = 'MissingKindError';
  }
}

/** Column-only. `kind` is a NOT-NULL column since stage C and every payload that
 *  crosses a boundary carries it; a missing/garbage `kind` throws rather than
 *  silently resolving (e.g. to 'leaf') — that silent default is the bug this
 *  function used to hide. */
export function kindOf(t: KindBearing | null | undefined): TodoKind {
  if (isTodoKind(t?.kind)) return t.kind;
  throw new MissingKindError(t);
}

export function isMission(t: KindBearing | null | undefined): boolean {
  return kindOf(t) === 'mission';
}

export function isEpic(t: KindBearing | null | undefined): boolean {
  return kindOf(t) === 'epic';
}

export function isLand(t: KindBearing | null | undefined): boolean {
  return kindOf(t) === 'land';
}

/** `isLeaf(t) === kindOf(t) === 'leaf'` — i.e. "not mission, not epic, not land".
 *  A `[LAND]` node is NOT a leaf under this definition even though it is childless
 *  work. Anything that today means "any executable node" must say
 *  `!isEpic(t) && !isMission(t)`, not `isLeaf(t)`. */
export function isLeaf(t: KindBearing | null | undefined): boolean {
  return kindOf(t) === 'leaf';
}

export function isGate(t: KindBearing | null | undefined): boolean {
  return kindOf(t) === 'gate';
}

/** A `KindBearing` that also has identity. Both the server `Todo` and the UI
 *  `SessionTodo` satisfy it. `parentId` is STRUCTURE, and structure is never a role:
 *  it is read only to answer "who is my parent", never "am I an epic". */
export interface IdentifiedKindBearing extends KindBearing {
  id: string;
  parentId?: string | null;
}

/** The set of todo ids that are epics BY DECLARED KIND.
 *  Replaces `new Set(childrenByParent.keys())` everywhere (PlanKanban.tsx:158,
 *  useFleetGraph.ts:142). A brand-new epic with zero children IS in this set; a leaf
 *  the auto-splitter gave nine children is NOT. */
export function epicIdSet<T extends IdentifiedKindBearing>(todos: readonly T[]): Set<string> {
  const out = new Set<string>();
  for (const t of todos) if (isEpic(t)) out.add(t.id);
  return out;
}

/** The id of this todo's parent IF that parent is a declared epic — else null.
 *  A child of a split LEAF returns null here: it is a sub-task of a leaf, not a lane
 *  member. Callers render such nodes under their leaf, not as an epic's children. */
export function parentEpicIdOf(
  t: IdentifiedKindBearing,
  epicIds: ReadonlySet<string>,
): string | null {
  return t.parentId != null && epicIds.has(t.parentId) ? t.parentId : null;
}

export const KIND_LABEL: Readonly<Record<TodoKind, string>> = {
  mission: '[MISSION]',
  epic: '[EPIC]',
  land: '[LAND]',
  leaf: '',
  gate: '[GATE]',
} as const;

export const labelFor = (kind: TodoKind): string => KIND_LABEL[kind] ?? '';

/** Strips exactly one leading role bracket for DISPLAY purposes only — this is a
 *  render transform, not a role decision. (The one title regex in this file; it
 *  does not feed `kindOf` or any predicate above.) */
const LABEL_RE = /^\s*\[(?:MISSION|EPIC|LAND)\]\s*/i;
export const stripLabel = (title: string | null | undefined): string =>
  (title ?? '').replace(LABEL_RE, '').trim();

/** Payloads that MUST resolve. Every one carries a valid `kind`; titles are deliberately
 *  adversarial (a bare title, and a title whose stale prefix CONTRADICTS the column) to
 *  prove no predicate reads a title.
 *  Both src/services/__tests__/todo-kind.test.ts and the UI mirror's test iterate this. */
export const KIND_FIXTURE: ReadonlyArray<{ input: KindBearing; expect: TodoKind }> = [
  { input: { kind: 'mission', title: 'Converge on X' }, expect: 'mission' },
  { input: { kind: 'epic', title: '[MISSION] stale prefix, column wins' }, expect: 'epic' },
  { input: { kind: 'epic', title: 'Bugfix inbox' }, expect: 'epic' },
  { input: { kind: 'land', title: 'Land X → master' }, expect: 'land' },
  { input: { kind: 'leaf', title: '[UI] topic tag is not a role' }, expect: 'leaf' },
  { input: { kind: 'leaf', title: null }, expect: 'leaf' },
  { input: { kind: 'gate', title: '[GATE] Decide: what is a leaf' }, expect: 'gate' },
];

/** Payloads that MUST THROW (BOMB 2). A missing/garbage `kind` is a producer bug; it must
 *  never silently resolve to 'leaf'. Titles here still carry role prefixes precisely to
 *  prove the prefix is NOT consulted. */
export const KIND_THROW_FIXTURE: ReadonlyArray<{ input: KindBearing | null | undefined }> = [
  { input: { kind: null, title: '[MISSION] Converge' } },
  { input: { kind: undefined, title: '[EPIC] Foo' } },
  { input: { title: 'plain leaf' } },
  { input: { kind: 'bogus' as TodoKind, title: '[LAND] x' } },
  { input: {} },
  { input: null },
  { input: undefined },
];

/** STRUCTURE TRAP (the 9acb7cb2 bug). Every case carries the child/parent structure that
 *  the OLD emergent definition ("an epic is any todo that is some other todo's parent")
 *  would have misread. The predicates must ignore `childCount` and `parentId` entirely. */
export const STRUCTURE_FIXTURE: ReadonlyArray<{
  name: string;
  input: IdentifiedKindBearing;
  childCount: number;
  expect: TodoKind;
}> = [
  { name: 'split leaf with 9 children is STILL a leaf (todo 9acb7cb2)',
    input: { id: '9acb7cb2', kind: 'leaf', title: 'UI still infers epic from has-children', parentId: 'e1' },
    childCount: 9, expect: 'leaf' },
  { name: 'brand-new epic with ZERO children is STILL an epic',
    input: { id: 'e-new', kind: 'epic', title: 'Freshly created epic', parentId: null },
    childCount: 0, expect: 'epic' },
  { name: 'child of a split leaf is a leaf whose parent is not an epic',
    input: { id: 'c1', kind: 'leaf', title: 'file 1 of 9', parentId: '9acb7cb2' },
    childCount: 0, expect: 'leaf' },
  { name: 'ordinary epic with children',
    input: { id: 'e1', kind: 'epic', title: 'kind column migration', parentId: null },
    childCount: 3, expect: 'epic' },
  { name: 'LAND node parented to an epic is land, never a lane',
    input: { id: 'l1', kind: 'land', title: 'merge to master', parentId: 'e1' },
    childCount: 0, expect: 'land' },
];

/** CREATE-TIME resolution. `CreateTodoInput.kind` is optional and an absent kind on a
 *  create means 'leaf' — the only safe default (you cannot accidentally mint an epic or
 *  a mission). This is NOT `kindOf`: reading a STORED row with a missing kind stays a
 *  hard MissingKindError (decision ea83ac9f). A garbage non-empty kind still throws —
 *  only *absence* defaults. The title is never consulted. */
export function kindOfInput(input: KindBearing | null | undefined): TodoKind {
  if (input?.kind == null) return 'leaf';
  return kindOf(input);            // garbage kind ('bogus') still throws
}

export const isEpicInput   = (i: KindBearing | null | undefined) => kindOfInput(i) === 'epic';
export const isMissionInput = (i: KindBearing | null | undefined) => kindOfInput(i) === 'mission';
