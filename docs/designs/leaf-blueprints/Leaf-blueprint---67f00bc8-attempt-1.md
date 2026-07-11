# Blueprint — Z9 trust/action-polish pure selectors

**Leaf:** `67f00bc8-4732-49e9-bf91-e89f97887c26`
**Single file to edit:** `ui/src/lib/triageSelectors.ts` (pure selector module; ~76 LOC today)

## Scope discipline

This leaf is a SPLIT child whose only deliverable is `ui/src/lib/triageSelectors.ts`.
The Z9 feature set (refreshSummaryNow, snoozeItem, operator-gated mark, optimistic
clear/undo, threshold tuning, mobile-parity verification) is realized across three
layers: the store (`supervisorStore.ts`), the Zen components (`ZenMode.tsx`,
`WedgeFocusCard.tsx`), and THIS pure-selector module. **We implement ONLY the pure
layer here** — the deterministic, side-effect-free helpers the store/components will
consume. We do NOT add store actions, REST calls, React state, or timers in this file.
Those live in sibling leaves; our job is to give them a tested pure surface so their
logic is trivial and uniform (which is also what makes the Phase-2 mobile port a thin
client — see Mobile-parity note).

`triageSelectors.ts` already follows the house style of the sibling pure modules
(`paragraphStack.ts`, `freshnessSelectors.ts`): locally-declared mirror types so it
compiles independently of store edits, named `select*` functions, exported constants,
and a colocated vitest suite (`triageSelectors.test.ts`). We extend it the same way and
keep 100% backward compatibility with the existing test file (no signature breaks —
new parameters are optional trailing args / options bags).

## Existing surface (do not break)

- Types: `ProgressState`, `SessionSummary` (mirror), `TriageItem` (discriminated:
  `escalation` | `wedge` | `unknown`).
- Constants: `SEV_GATED_OR_WEDGED = 3`, `SEV_ROUTINE = 2`, `SEV_UNKNOWN_SOFT = 1`.
- Functions: `escalationSeverity(e)`, `selectTriageStack(open, summaries, now)`,
  `selectTriageTop(open, summaries, now)`, `wedgeMinutes(summary, now)`.
- The current `selectTriageStack` reads `(e as {operatorGated?}).operatorGated`
  defensively; the store now actually declares `operatorGated?: boolean | number` on
  `Escalation` (confirmed `supervisorStore.ts:118`). Keep the defensive read.

The existing `triageSelectors.test.ts` calls every function with the CURRENT arity.
All new params MUST be optional so that suite stays green unchanged.

## Changes (exact shape)

### 1. Uniform triage-item identity — `triageItemId(item)`
Mobile-parity + optimistic-clear + only-you all need ONE stable string key per stack
item, regardless of kind, so the store can keep `Set<string>` collections (cleared,
only-you) and the UI can key taps uniformly (no per-kind branching, no hover state).

```ts
/** Stable, kind-uniform id for a triage item. Escalations use their server id;
 *  session items use `${kind}:${project}::${session}`. The single key the store's
 *  optimistic-clear / only-you Sets and the UI tap handlers all key off of. */
export function triageItemId(item: TriageItem): string {
  if (item.kind === 'escalation') return item.escalation.id;
  return `${item.kind}:${item.summary.project}::${item.summary.session}`;
}
```

### 2. Operator-gated "only you" local mark + deterministic outranking
The server stamps `operatorGated`. Z9 adds a LOCAL "only you" mark the operator can
toggle on any item to force it to the top tier (deterministic outranking) even when the
server didn't gate it. Implement as a pure promotion driven by a caller-supplied id set.

```ts
/** Effective gate = server stamp OR a local "only you" mark keyed by escalation id. */
export function effectiveOperatorGated(e: Escalation, onlyYouIds?: ReadonlySet<string>): boolean {
  const flag = (e as { operatorGated?: boolean | number }).operatorGated;
  return !!flag || !!onlyYouIds?.has(e.id);
}
```

Change `escalationSeverity` to accept the optional set and delegate:
```ts
export function escalationSeverity(e: Escalation, onlyYouIds?: ReadonlySet<string>): number {
  return effectiveOperatorGated(e, onlyYouIds) ? SEV_GATED_OR_WEDGED : SEV_ROUTINE;
}
```
(Existing single-arg callers/tests unaffected.) For `wedge`/`unknown` summary items the
only-you mark uses the same `triageItemId` key (`wedge:${proj}::${sess}`) — an
operator can pin an unknown session to the top tier; promotion bumps `SEV_UNKNOWN_SOFT`
→ `SEV_GATED_OR_WEDGED` inside the stack builder.

### 3. Optimistic clear + undo (pure half)
Optimistic clear: the UI removes an item immediately, shows a "sent → X" toast with a
5s undo, and the store reconciles against the server (reuse supervisor-store's
confirm-on-ok convention — that reconciliation is the STORE leaf's job, not ours). Our
pure contribution: (a) exclude optimistically-cleared ids from the stack, and (b) a
pure undo-window predicate + toast model so the component has no ad-hoc timing math.

Add an options bag to the stack builders (trailing, optional → backward compatible):
```ts
export interface TriageStackOpts {
  /** Items the operator has locally pinned to the top tier ("only you"). */
  onlyYouIds?: ReadonlySet<string>;
  /** Items optimistically cleared (action sent, awaiting server confirm). Excluded. */
  clearedIds?: ReadonlySet<string>;
}
```
In `selectTriageStack`, after building each item compute its `triageItemId` and:
- `continue` (skip) if `opts.clearedIds?.has(id)`;
- pass `opts.onlyYouIds` to `escalationSeverity` for escalations, and for `wedge`/
  `unknown` apply: `const sev = onlyYouIds?.has(id) ? SEV_GATED_OR_WEDGED : baseSev`.

Both `selectTriageStack` and `selectTriageTop` gain a trailing `opts: TriageStackOpts = {}`
and `selectTriageTop` forwards it.

Undo model (pure):
```ts
export const UNDO_WINDOW_MS = 5_000;

export interface PendingClear {
  id: string;          // triageItemId of the cleared item
  label: string;       // "sent → Approve" style toast text (caller-supplied)
  clearedAt: number;   // wall-clock when the optimistic clear fired
}

/** True while the 5s undo affordance should still be offered. */
export function withinUndoWindow(pending: PendingClear, now: number, windowMs = UNDO_WINDOW_MS): boolean {
  return now - pending.clearedAt < windowMs;
}

/** ms remaining on the undo affordance (≥0), for a countdown/auto-dismiss. */
export function undoMsRemaining(pending: PendingClear, now: number, windowMs = UNDO_WINDOW_MS): number {
  return Math.max(0, windowMs - (now - pending.clearedAt));
}
```

### 4. snoozeItem (client-side timer) pure half
`snoozeSession`/`snoozeSession`-store already sets `snoozedUntil`; `selectTriageStack`
already excludes `now < snoozedUntil`. Z9 wants `snoozeItem(id, ms)` semantics with a
client timer that RE-SURFACES on expiry. The pure pieces: a single default, a pure
deadline calc (replacing the `Date.now() + 10*60_000` literal hardcoded twice in
`ZenMode.tsx:98,123`), and the earliest-wakeup computation so the component schedules
exactly ONE `setTimeout` to re-surface.

```ts
export const DEFAULT_SNOOZE_MS = 10 * 60_000;

/** Absolute deadline for a snooze started at `now`. */
export function snoozeUntil(now: number, ms = DEFAULT_SNOOZE_MS): number {
  return now + ms;
}

/** Earliest FUTURE `snoozedUntil` across all summaries, or null if none pending.
 *  The component arms a single timer for `wakeup - now` to re-surface on expiry —
 *  no per-card polling. */
export function nextSnoozeWakeup(
  summaries: Record<string, SessionSummary>,
  now: number,
): number | null {
  let next: number | null = null;
  for (const s of Object.values(summaries)) {
    if (s.snoozedUntil && s.snoozedUntil > now && (next === null || s.snoozedUntil < next)) {
      next = s.snoozedUntil;
    }
  }
  return next;
}
```

### 5. Threshold tuning — `clampWatchdogThreshold`
`set_watchdog_threshold` (MCP/REST) is wired by the store leaf. Our pure contribution is
input hygiene so the slider/stepper can't send a nonsense value: clamp to a sane minute
range and coerce to an integer. (Pure; no I/O.)

```ts
export const WATCHDOG_THRESHOLD_MIN_MIN = 1;
export const WATCHDOG_THRESHOLD_MAX_MIN = 120;

/** Clamp+round a user-entered wedged-threshold (minutes) before it is sent to
 *  set_watchdog_threshold. NaN/≤0 → MIN; >MAX → MAX. */
export function clampWatchdogThreshold(minutes: number): number {
  if (!Number.isFinite(minutes)) return WATCHDOG_THRESHOLD_MIN_MIN;
  return Math.min(WATCHDOG_THRESHOLD_MAX_MIN, Math.max(WATCHDOG_THRESHOLD_MIN_MIN, Math.round(minutes)));
}
```

### 6. refreshSummaryNow force-proof (pure predicate only)
The out-of-band re-hash/re-summarize REST round-trip is the store leaf's. The only pure
piece that belongs here is the "is this summary stale enough to justify a manual force"
predicate, reusing the existing `refreshState` field on `SessionSummary`:

```ts
/** A summary the operator may want to force-refresh: the loop reported it
 *  stale-failing, OR no interpreter update within `staleMs`. Pure gate for
 *  enabling the "Refresh now" affordance (the REST call lives in the store). */
export function isRefreshable(s: SessionSummary, now: number, staleMs = 2 * 60_000): boolean {
  if (s.refreshState === 'stale-failing') return true;
  const last = s.summaryUpdatedAt ?? 0;
  return last > 0 && now - last >= staleMs;
}
```

### Mobile-parity note (verification, no code beyond the above)
The parent spec asks us to "confirm every zone reads from HTTP read-models + WS only
(no hover-to-reveal; tap uniform)." This file is the load-bearing proof for the triage
zone: by routing ALL item identity, clear, only-you, snooze, and severity through pure
functions over `(openEscalations, sessionSummaries)` — both of which are populated
exclusively from HTTP hydrate + WS ingest in the store — the triage zone has **no
client-only data source and no hover-derived state**. `triageItemId` gives every item a
uniform tap key (no kind-specific hover reveal). Document this in a top-of-file comment
block so the Phase-2 mobile port can rely on it. No DOM, no `window`, no `Date.now()`
inside this module (callers pass `now`) — keeping it SSR/test/mobile-portable.

## Comment/style requirements
- Keep the existing top-of-file mirror-type note; extend it with the mobile-parity
  invariant paragraph above.
- Match existing terse `/** … */` doc style; cite the Z-phase rationale inline like the
  current `SEV_*` comments do (`// Z9: …`).
- No new imports beyond the existing `import type { Escalation }`.

## Test guidance (extend `triageSelectors.test.ts` — SIBLING test leaf may own this; if
this leaf includes the test, add cases, do NOT rewrite existing ones)
- `triageItemId`: escalation→id; wedge/unknown→`kind:proj::sess`.
- `effectiveOperatorGated`: server flag true; local mark true; neither false.
- `selectTriageStack` with `onlyYouIds`: an otherwise-routine escalation and an
  `unknown` session both promote to `SEV_GATED_OR_WEDGED`.
- `selectTriageStack` with `clearedIds`: cleared escalation + cleared wedge excluded.
- Backward-compat: 3-arg calls still behave exactly as today (the existing suite).
- `withinUndoWindow`/`undoMsRemaining`: inside/at/after the 5s window.
- `snoozeUntil`/`nextSnoozeWakeup`: earliest future deadline; ignores expired/absent.
- `clampWatchdogThreshold`: NaN→min, 0→min, 1000→max, 3.6→4.
- `isRefreshable`: stale-failing→true; fresh-recent→false; old→true; never-updated→false.

## Risks / watch-outs
- DO NOT change `SEV_*` constant values — `triageSelectors.test.ts` pins `3/2/1` and the
  store/components depend on the ordering.
- Keep all new params OPTIONAL and TRAILING; the existing test arity must compile.
- No `Date.now()` in this module — callers inject `now` (consistency with the suite's
  fixed `NOW`, and mobile/SSR portability).
- `ReadonlySet<string>` for the id sets so callers can pass the store's Sets directly
  without defensive copies.

```json
{ "schemaVersion": 1, "estimatedFiles": 1, "estimatedTasks": 6,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["ui/src/lib/triageSelectors.ts"],
  "tasks": [
    { "id": "item-identity", "files": ["ui/src/lib/triageSelectors.ts"], "description": "Add triageItemId(item) uniform kind-agnostic key" },
    { "id": "only-you-gate", "files": ["ui/src/lib/triageSelectors.ts"], "description": "effectiveOperatorGated + escalationSeverity(onlyYouIds) deterministic top-tier promotion" },
    { "id": "stack-opts", "files": ["ui/src/lib/triageSelectors.ts"], "description": "TriageStackOpts (onlyYouIds/clearedIds) threaded through selectTriageStack/selectTriageTop, backward-compatible" },
    { "id": "optimistic-undo", "files": ["ui/src/lib/triageSelectors.ts"], "description": "PendingClear model + UNDO_WINDOW_MS + withinUndoWindow/undoMsRemaining" },
    { "id": "snooze-timer", "files": ["ui/src/lib/triageSelectors.ts"], "description": "DEFAULT_SNOOZE_MS + snoozeUntil + nextSnoozeWakeup (single re-surface timer)" },
    { "id": "threshold-and-refresh", "files": ["ui/src/lib/triageSelectors.ts"], "description": "clampWatchdogThreshold + isRefreshable force-proof predicate + mobile-parity header comment" }
  ] }
```
