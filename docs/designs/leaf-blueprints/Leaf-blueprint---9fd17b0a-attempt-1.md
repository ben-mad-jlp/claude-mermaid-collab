# Blueprint — Z4: CRITICAL GATE — `selectTriageStack` ranking unit test

## Goal
Add a **vitest** unit test that locks the load-bearing ranking invariant of the Zen
queue-of-one: **operator-gated escalations AND wedged sessions deterministically
outrank routine approvals/decisions**, `selectTriageTop` returns the single most-urgent
item, and **ties break by age (oldest `since` first)**. This is a build gate — the test
must fail if the ranking ever regresses.

## Code under test (already implemented — DO NOT modify)
File: `ui/src/lib/triageSelectors.ts`

Exports to test:
- `selectTriageStack(openEscalations, sessionSummaries, now)` → `TriageItem[]`, sorted
  by `severity DESC` then `since ASC` (`(b.severity - a.severity) || (a.since - b.since)`).
- `selectTriageTop(...)` → first item of the stack or `null`.
- `wedgeMinutes(summary, now)` (optional sanity assertion).
- Severity constants: `SEV_GATED_OR_WEDGED = 3`, `SEV_ROUTINE = 2`, `SEV_UNKNOWN_SOFT = 1`.
- `escalationSeverity(e)` → 3 if `operatorGated` truthy else 2.

Key behaviors the test must pin (from reading the source):
- Escalations are included only when `e.status === 'open'`; severity from `operatorGated`.
- Session summaries enter the stack only when `progressState === 'wedged'` (sev 3) or
  `'unknown'` (sev 1). `active`/`quiet`/`stalled` are EXCLUDED.
- Session `since` is `s.paneSeenAt`; escalation `since` is `e.createdAt`.
- Snoozed sessions (`s.snoozedUntil && now < s.snoozedUntil`) are excluded.
- `selectTriageStack` reads `sessionSummaries` via `Object.values(...)` (a Record).

## File to create
`ui/src/lib/triageSelectors.test.ts`

Match the conventions in `ui/src/lib/statusSelectors.test.ts`:
- `import { describe, it, expect } from 'vitest';`
- `import type { Escalation } from '@/stores/supervisorStore';`
- Import the real selectors + types + constants from `./triageSelectors`:
  `selectTriageStack, selectTriageTop, wedgeMinutes, escalationSeverity,
   SEV_GATED_OR_WEDGED, SEV_ROUTINE, SEV_UNKNOWN_SOFT, type SessionSummary`.
- Build fixtures with small factory helpers cast `as Escalation` (the type has many
  required fields the selector ignores — cast like the sibling test does).

## Fixture helpers (exact shape)
```ts
const esc = (id: string, status: string, createdAt: number, operatorGated?: boolean): Escalation =>
  ({ id, project: 'p', session: 's', kind: 'decision', questionText: 'q',
     status, createdAt, operatorGated }) as Escalation;

const summary = (
  session: string,
  progressState: SessionSummary['progressState'],
  paneSeenAt: number,
  extra: Partial<SessionSummary> = {},
): SessionSummary =>
  ({ project: 'p', session, progressState, paneSeenAt, updatedAt: paneSeenAt, ...extra });

const asRecord = (...s: SessionSummary[]): Record<string, SessionSummary> =>
  Object.fromEntries(s.map((x) => [`${x.project}:${x.session}`, x]));
```

## Required test cases (`describe('selectTriageStack', ...)`)

1. **operator-gated + wedged outrank routine approvals (core invariant).**
   Mixed set: routine approve escalation (`operatorGated` falsy), operator-gated
   decision escalation, a `wedged` session, an `unknown` session.
   - Assert: the resulting `severity` of every gated/wedged item is `SEV_GATED_OR_WEDGED`
     and strictly `>` the routine escalation's `SEV_ROUTINE`.
   - Assert ordering: in the returned array, **every** gated/wedged item appears at a
     lower index than **every** routine-approve item, and routine appears before the
     `unknown` item. Concretely assert the `severity` sequence is non-increasing
     (`stack.map(i => i.severity)` is sorted DESC) — a strong, position-independent guard.

2. **`selectTriageTop` returns the most-urgent item.**
   With a set containing exactly one operator-gated escalation among routine items,
   assert `selectTriageTop(...)` is that gated escalation (`kind: 'escalation'` and its
   `escalation.id` / `severity === SEV_GATED_OR_WEDGED`).

3. **Wedge buried under a routine approve is rescued (regression scenario from the
   design risk).** Construct a routine approve with an OLDER `createdAt` (so age alone
   would float it up) and a wedged session with a NEWER `paneSeenAt`. Assert the wedge
   still sorts above the routine approve (severity dominates age). This is the exact
   "wedge buried under a routine approve" failure the gate guards against.

4. **Ties broken by age (oldest first) within the top tier.**
   Two top-tier items at `SEV_GATED_OR_WEDGED` (e.g. one gated escalation `since=100`,
   one wedged session `since=50`). Assert the `since=50` item sorts first
   (`stack[0].since === 50`), and `selectTriageTop` returns it.
   Add a second tie assertion among two routine escalations to confirm age ordering at
   the `SEV_ROUTINE` tier too.

5. **Exclusions hold (guards the inputs the ranking depends on).**
   - A non-`open` escalation is omitted.
   - `active`/`quiet`/`stalled` sessions are omitted (only `wedged`/`unknown` enter).
   - A wedged session with `snoozedUntil > now` is omitted; with `snoozedUntil < now`
     it is included.
   - Empty inputs → `selectTriageStack` returns `[]` and `selectTriageTop` returns `null`.

6. **`escalationSeverity` unit pin (cheap direct assertion):**
   `escalationSeverity(esc(..., operatorGated:true)) === SEV_GATED_OR_WEDGED` and
   falsy → `SEV_ROUTINE`. Confirms the constant relationship `3 > 2 > 1` so the test
   fails loudly if the tiers are ever re-numbered.

## Determinism note
Pass an explicit numeric `now` to every selector call (e.g. `1_000_000`) and explicit
`createdAt` / `paneSeenAt` values — never `Date.now()`. The selector's sort is total and
stable given distinct `since` values; use distinct `since` per item in ordering asserts
to avoid relying on engine sort stability.

## Verification
```bash
npm run test:ci -- ui/src/lib/triageSelectors.test.ts
```
(Tests in `ui/` run under vitest; `test:ci` is the non-interactive runner per CLAUDE.md.)
All cases must pass against the existing `triageSelectors.ts` (no source change expected;
if any case fails, that is a real ranking bug to escalate, not a test to weaken).

```json
{ "schemaVersion": 1, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": ["ui/src/lib/triageSelectors.test.ts"], "filesToEdit": [],
  "tasks": [ { "id": "triage-ranking-test", "files": ["ui/src/lib/triageSelectors.test.ts"], "description": "Add vitest unit test pinning selectTriageStack/selectTriageTop ranking: gated+wedged outrank routine, ties broken by age, exclusions hold" } ] }
```
