/**
 * todoKind.ts (UI mirror) — the SINGLE predicate the UI is allowed to use to
 * answer "what ROLE does this todo play" (mission / epic / land / leaf).
 *
 * This is a byte-faithful mirror of the backend source of truth
 * `src/services/todo-kind.ts`. It exists separately ONLY because the backend
 * module's predicates take a backend `Todo` (imported from `todo-store`, which
 * pulls in `bun:sqlite` and does not typecheck under the UI's `include: ["src"]`
 * config) — same precedent as `ui/src/lib/claimability.ts`. The function BODIES
 * are identical; keep them in lockstep with the backend if the rule ever changes.
 *
 * This module has ZERO runtime imports (type-only at most) so a backend test can
 * import it directly to prove server/UI agreement.
 */

export type TodoKind = 'mission' | 'epic' | 'land' | 'leaf' | 'gate';

/** Structural shape the predicates below need. Deliberately NOT bound to
 *  `SessionTodo` — sibling readers pass narrower shapes and the shared
 *  server/UI test fixture passes plain objects. `SessionTodo` is structurally
 *  assignable to this (kind?/title both present). */
export interface KindBearing {
  kind?: TodoKind | null;
  title?: string | null;
}

/** @deprecated legacy name for {@link KindBearing}; kept so existing imports compile. */
export type TodoLike = KindBearing;

const KINDS = ['mission', 'epic', 'land', 'leaf', 'gate'] as const;
const isTodoKind = (v: unknown): v is TodoKind =>
  typeof v === 'string' && (KINDS as readonly string[]).includes(v);

export class MissingKindError extends Error {
  constructor(t: KindBearing | null | undefined) {
    super(
      `todoKind: kindOf() received a payload with no valid \`kind\` ` +
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
export const kindOf = (t: KindBearing | null | undefined): TodoKind => {
  if (isTodoKind(t?.kind)) return t.kind;
  throw new MissingKindError(t);
};

export const isMission = (t: KindBearing | null | undefined): boolean => kindOf(t) === 'mission';
export const isEpic = (t: KindBearing | null | undefined): boolean => kindOf(t) === 'epic';
export const isLand = (t: KindBearing | null | undefined): boolean => kindOf(t) === 'land';
/** `isLeaf(t) === kindOf(t) === 'leaf'` — i.e. "not mission, not epic, not land".
 *  A `[LAND]` node is NOT a leaf under this definition even though it is childless
 *  work. Anything that today means "any executable node" must say
 *  `!isEpic(t) && !isMission(t)`, not `isLeaf(t)`. */
export const isLeaf = (t: KindBearing | null | undefined): boolean => kindOf(t) === 'leaf';
export const isGate = (t: KindBearing | null | undefined): boolean => kindOf(t) === 'gate';

/** A `KindBearing` that also has identity. Both the server `Todo` and the UI
 *  `SessionTodo` satisfy it. `parentId` is STRUCTURE, and structure is never a role:
 *  it is read only to answer "who is my parent", never "am I an epic". */
export interface IdentifiedKindBearing extends KindBearing {
  id: string;
  parentId?: string | null;
}

export const KIND_LABEL: Readonly<Record<TodoKind, string>> = {
  mission: '[MISSION]',
  epic: '[EPIC]',
  land: '[LAND]',
  leaf: '',
  gate: '[GATE]',
};

/** Human-facing bracket label, for RENDER only. Nothing stores this; it is display
 *  output, never parsed back and never persisted. */
export const labelFor = (kind: TodoKind): string => KIND_LABEL[kind] ?? '';

/** Strips exactly one leading role bracket for DISPLAY purposes only — this is a
 *  render/identity transform, not a role decision. Byte-mirror of the backend
 *  `stripLabel` (`src/services/todo-kind.ts`). */
const LABEL_RE = /^\s*\[(?:MISSION|EPIC|LAND)\]\s*/i;
export const stripLabel = (title: string | null | undefined): string =>
  (title ?? '').replace(LABEL_RE, '').trim();

/** Alias of {@link stripLabel}. One rule, one regex (acceptance: no duplicated rules).
 *  Display-only; it never decides a role. Note: gains .trim() from stripLabel to agree
 *  with the server; both call sites (conductingView label text, MissionsStrip chip text)
 *  are pure display paths where trimming is safe. */
export const stripKindPrefix = stripLabel;

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

/** Create-time resolution functions (`kindOfInput`, `isEpicInput`, `isMissionInput`) are
 *  deliberately NOT mirrored here. Those functions default an absent `kind` to 'leaf' on
 *  create-time inputs; the UI is a render path that never creates, so importing a
 *  create-time default into a render path violates decision ea83ac9f. */
