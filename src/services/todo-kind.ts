import type { TodoKind } from './claimability.ts';

export type { TodoKind };

/** The minimum a caller must supply. Structural so BOTH the server `Todo`
 *  (todo-store.ts) and the UI `SessionTodo` (ui/src/types/sessionTodo.ts) satisfy
 *  it without either side importing the other's aggregate. */
export interface KindBearing {
  kind?: TodoKind | null;
  title?: string | null;
}

const KINDS = ['mission', 'epic', 'land', 'leaf'] as const;
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

export const KIND_LABEL: Readonly<Record<TodoKind, string>> = {
  mission: '[MISSION]',
  epic: '[EPIC]',
  land: '[LAND]',
  leaf: '',
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
