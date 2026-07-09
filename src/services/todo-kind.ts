import type { TodoKind } from './claimability.ts';
import { kindFromTitle } from './claimability.ts';

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

/** Column-first, title-fallback. The fallback (step 3) is not a hedge — it is the
 *  correctness bridge that makes the reader switch a no-op for any object that
 *  hasn't been through the DB (in-memory literals, MCP payloads, stale WS frames).
 *  It stays until stage C removes title prefixes (decision e852fb0c), at which
 *  point it becomes a no-op by construction. */
export function kindOf(t: KindBearing | null | undefined): TodoKind {
  if (!t) return 'leaf';
  if (isTodoKind(t.kind)) return t.kind;
  return kindFromTitle(t.title);
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
 *  work; that matches `kindFromTitle`'s precedence. Anything that today means "any
 *  executable node" must say `!isEpic(t) && !isMission(t)`, not `isLeaf(t)`. */
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

/** The ONE shared fixture proving server and UI predicates agree (stage B acceptance).
 *  Both src/services/__tests__/todo-kind.test.ts and the UI mirror's test iterate this. */
export const KIND_FIXTURE: ReadonlyArray<{ input: KindBearing; expect: TodoKind }> = [
  { input: { kind: 'mission', title: 'no prefix' }, expect: 'mission' },
  { input: { kind: 'epic', title: '[MISSION] x' }, expect: 'epic' },
  { input: { kind: null, title: '[MISSION] Converge' }, expect: 'mission' },
  { input: { kind: null, title: '[EPIC] Foo' }, expect: 'epic' },
  { input: { kind: null, title: '[LAND] → master' }, expect: 'land' },
  { input: { kind: null, title: 'plain leaf' }, expect: 'leaf' },
  { input: { kind: undefined, title: '  [epic] lower' }, expect: 'epic' },
  { input: { kind: 'bogus' as TodoKind, title: '[LAND] x' }, expect: 'land' },
  { input: { title: null }, expect: 'leaf' },
  { input: {}, expect: 'leaf' },
];
