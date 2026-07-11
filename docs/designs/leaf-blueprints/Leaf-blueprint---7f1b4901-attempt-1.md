# Blueprint — Z9 FocusCard.tsx: trust + action polish + mobile-parity

**Leaf:** `7f1b4901-155d-4a50-84ad-dd0dc75165e0`
**Implement ONLY:** `ui/src/components/supervisor/zen/FocusCard.tsx`
**Split child of** leaf `24237fce` (auto-decomposed). Sibling tasks own the store slice
(`supervisorStore`), the pure selectors (`triageSelectors.ts` — already landed), `ZenMode.tsx`
wiring, and the test files. **Do not edit any of those.**

## Context (read, do not modify)

- `ui/src/components/supervisor/zen/FocusCard.tsx` — current presentational card for the
  triage-top **escalation**. Props: `escalation`, `serverScope`, `onDecide`, `onResolve`,
  `onLand`. Renders option buttons, an epic-land branch, or a plain Resolve button. All
  action affordances already live on `<button>` elements (tap-uniform).
- `ui/src/components/supervisor/zen/WedgeFocusCard.tsx` — sibling card for wedge/unknown
  sessions; already carries `onSnooze`. **Snooze belongs to the wedge card, NOT FocusCard.**
- `ui/src/lib/triageSelectors.ts` — pure Z9 helpers ALREADY landed and available to import:
  `effectiveOperatorGated`, `PendingClear`, `withinUndoWindow`, `undoMsRemaining`,
  `UNDO_WINDOW_MS`. The "only-you" mark and optimistic-clear/undo *timing model* is pure here;
  FocusCard only renders the affordances and calls back.
- `ui/src/components/supervisor/zen/ZenMode.tsx:82-90` — the only call site of `FocusCard`.
  A sibling task wires new props here; this leaf must keep all new props **optional** so the
  existing 5-prop call site still compiles unchanged.
- `ui/src/components/supervisor/zen/__tests__/mobile-parity.test.tsx` — source-scanning
  invariants this file MUST satisfy:
  - **No hover-to-reveal:** no `group-hover:opacity|block|flex|visible`, no
    `onMouseEnter|onMouseOver|onMouseLeave`. (Cosmetic `hover:bg-*` is allowed.)
  - **No direct transport:** no `new WebSocket(`, `fetch(`, `axios`, `EventSource`.
  - **Tap-uniform:** any file containing `onClick` must also contain `<button`. Every new
    affordance MUST be a `<button type="button">`.

## Change shape (FocusCard.tsx only)

Extend `FocusCardProps` with optional Z9 fields and render two new affordances. Keep the file
purely presentational — all state/timers/REST live in the store (sibling). No `Date.now()`,
no `useEffect` timers, no network.

### 1. Operator-gated "only you" mark (operator-gated mark + deterministic outranking)

Add optional props:
```ts
isOnlyYou?: boolean;                         // effectiveOperatorGated(e, onlyYouIds) result, computed by caller
onToggleOnlyYou?: (serverId: string, id: string) => void;
```
Render a small `<button type="button">` in the card header row (next to the
"⚠ Decision required" label) ONLY when `onToggleOnlyYou` is provided. Label/affordance:
`★ Only you` when `isOnlyYou`, `☆ Only you` otherwise; `aria-pressed={!!isOnlyYou}`,
`title="Pin to top tier (only you can clear)"`. onClick → `onToggleOnlyYou(serverScope, e.id)`.
Style with existing accent classes when active (`text-accent-600 dark:text-accent-400`),
muted gray otherwise. This is the visual half of the deterministic outranking the selector
already implements via `effectiveOperatorGated` / `onlyYouIds`.

### 2. Optimistic clear + "sent → X" + 5s undo

Add optional props:
```ts
pending?: import('@/lib/triageSelectors').PendingClear | null;  // { id, label, clearedAt }
now?: number;                                                   // injected wall-clock (caller passes Date.now())
onUndo?: (serverId: string, id: string) => void;
```
When `pending` is non-null AND (`now == null` OR `withinUndoWindow(pending, now)` is true),
render an undo affordance INSTEAD OF / above the action buttons:
- A line: `sent → {pending.label}` (use `text-3xs text-gray-500`).
- A `<button type="button">` `Undo` → `onUndo(serverScope, e.id)`.
- If `now != null`, show remaining seconds via `Math.ceil(undoMsRemaining(pending, now)/1000)`
  e.g. `Undo (5s)`. Do NOT run a timer here — the parent re-renders with a fresh `now`;
  this card stays a pure function of props (mobile-parity / SSR-portable).

When `pending` is null/expired, render the existing options/land/resolve UI unchanged.

### Backward-compat & guards
- ALL new props optional → `ZenMode.tsx:83` (5-prop call) still type-checks; sibling adds
  wiring later.
- Import the pure helpers from `@/lib/triageSelectors` (`withinUndoWindow`, `undoMsRemaining`,
  `PendingClear` type) — they already exist; do NOT redefine them.
- Keep `React.FC` shape, `data-testid="focus-card"`, and existing classnames/branches intact;
  this is additive polish, not a rewrite.
- No new hover-reveal, no transport calls, every new onClick on a `<button type="button">`
  (satisfies all three mobile-parity scans).

## Verification
- `npm run test:ci -- ui/src/components/supervisor/zen/__tests__/mobile-parity.test.tsx`
  (source-scan invariants must stay green; FocusCard must not introduce forbidden patterns).
- `npx tsc -p ui/tsconfig.json --noEmit` (or the project's typecheck) — new optional props
  must not break the existing FocusCard call site in `ZenMode.tsx`.

```json
{ "schemaVersion": 1, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["ui/src/components/supervisor/zen/FocusCard.tsx"],
  "tasks": [
    { "id": "focuscard-z9-polish", "files": ["ui/src/components/supervisor/zen/FocusCard.tsx"], "description": "Add optional operator-gated 'only you' toggle button and optimistic-clear 'sent → X' + 5s Undo affordance (pure props, importing withinUndoWindow/undoMsRemaining/PendingClear from triageSelectors), keeping all new props optional and mobile-parity-clean (button-only, no hover-reveal, no transport)." }
  ] }
```
