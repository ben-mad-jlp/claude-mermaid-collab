/**
 * todoKind.ts (UI mirror) — the SINGLE predicate the UI is allowed to use to
 * answer "what ROLE does this todo play" (mission / epic / land / leaf).
 *
 * This is a byte-faithful mirror of the backend source of truth
 * `src/services/claimability.ts` (see `kindFromTitle`/`TodoKind` there). It exists
 * separately ONLY because the backend module's predicates take a backend `Todo`
 * (imported from `todo-store`, which pulls in `bun:sqlite` and does not typecheck
 * under the UI's `include: ["src"]` config) — same precedent as
 * `ui/src/lib/claimability.ts`. The function BODIES are identical; keep them in
 * lockstep with the backend if the rule ever changes.
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

// Legacy title-prefix regexes (module-private — do NOT re-export these; publishing
// title predicates would invite new title readers, the exact thing stage B exists
// to eliminate). Mirrors src/services/claimability.ts:29,46,55 verbatim.
const isMissionTitle = (title: string | null | undefined): boolean =>
  /^\s*\[MISSION\]/i.test(title ?? '');
const isEpicTitle = (title: string | null | undefined): boolean =>
  /^\s*\[EPIC\]/i.test(title ?? '');
const isLandTitle = (title: string | null | undefined): boolean =>
  /^\s*\[LAND\]/i.test(title ?? '');

/** Legacy title-prefix regexes. STAGE C: delete — nothing may read a title for a
 *  role. Mission is checked FIRST; that order is load-bearing (mirrors
 *  src/services/claimability.ts:62-67 verbatim). */
export const kindFromTitle = (title: string | null | undefined): TodoKind => {
  if (isMissionTitle(title)) return 'mission';
  if (isEpicTitle(title)) return 'epic';
  if (isLandTitle(title)) return 'land';
  return 'leaf';
};

/** Resolve the role of a node. Reads the `kind` column; falls back to the legacy
 *  title prefix ONLY for pre-column payloads (WebSocket frames replayed from an old
 *  snapshot, test fixtures, optimistic client-side todos). STAGE C: drop the
 *  fallback — kind is then guaranteed on every payload. */
export const kindOf = (t: TodoLike | null | undefined): TodoKind => {
  if (!t) return 'leaf';
  if (t.kind != null) return t.kind;
  return kindFromTitle(t.title); // STAGE C: delete this fallback
};

export const isMission = (t: TodoLike | null | undefined): boolean => kindOf(t) === 'mission';
export const isEpic = (t: TodoLike | null | undefined): boolean => kindOf(t) === 'epic';
export const isLand = (t: TodoLike | null | undefined): boolean => kindOf(t) === 'land';
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
