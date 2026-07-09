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

export type TodoKind = 'mission' | 'epic' | 'land' | 'leaf';

/** Structural shape the predicates below need. Deliberately NOT bound to
 *  `SessionTodo` — sibling readers pass narrower shapes and the shared
 *  server/UI test fixture passes plain objects. `SessionTodo` is structurally
 *  assignable to this (kind?/title both present). */
export type TodoLike = { kind?: TodoKind | null; title?: string | null };

const KINDS = ['mission', 'epic', 'land', 'leaf'] as const;
const isTodoKind = (v: unknown): v is TodoKind =>
  typeof v === 'string' && (KINDS as readonly string[]).includes(v);

export class MissingKindError extends Error {
  constructor(t: TodoLike | null | undefined) {
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
export const kindOf = (t: TodoLike | null | undefined): TodoKind => {
  if (isTodoKind(t?.kind)) return t.kind;
  throw new MissingKindError(t);
};

export const isMission = (t: TodoLike | null | undefined): boolean => kindOf(t) === 'mission';
export const isEpic = (t: TodoLike | null | undefined): boolean => kindOf(t) === 'epic';
export const isLand = (t: TodoLike | null | undefined): boolean => kindOf(t) === 'land';
/** `isLeaf(t) === kindOf(t) === 'leaf'` — i.e. "not mission, not epic, not land".
 *  A `[LAND]` node is NOT a leaf under this definition even though it is childless
 *  work. Anything that today means "any executable node" must say
 *  `!isEpic(t) && !isMission(t)`, not `isLeaf(t)`. */
export const isLeaf = (t: TodoLike | null | undefined): boolean => kindOf(t) === 'leaf';

const LABELS: Record<TodoKind, string> = {
  mission: '[MISSION]',
  epic: '[EPIC]',
  land: '[LAND]',
  leaf: '',
};

/** Human-facing bracket label, for RENDER only. Nothing stores this; it is display
 *  output, never parsed back and never persisted. */
export const labelFor = (kind: TodoKind): string => LABELS[kind];

const PREFIX_RE = /^\s*\[(MISSION|EPIC|LAND)\]\s*/i;

/** Strip a leading role label from a title for display (generalizes
 *  MissionsStrip.tsx's stripMissionPrefix). Render-only — it does not decide a
 *  role. Becomes a safe no-op after stage C strips the stored prefixes. */
export const stripKindPrefix = (title: string | null | undefined): string =>
  (title ?? '').replace(PREFIX_RE, '');

/** Strips exactly one leading role bracket for DISPLAY purposes only — this is a
 *  render/identity transform, not a role decision. Byte-mirror of the backend
 *  `stripLabel` (`src/services/todo-kind.ts`). */
const LABEL_RE = /^\s*\[(?:MISSION|EPIC|LAND)\]\s*/i;
export const stripLabel = (title: string | null | undefined): string =>
  (title ?? '').replace(LABEL_RE, '').trim();
