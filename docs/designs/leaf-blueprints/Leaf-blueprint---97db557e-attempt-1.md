# Blueprint — Tests + live verification for the self-summary loop

## Goal

Add unit coverage for the **self-summary nudge-pass gating** and a health-drop
assertion proving interpret attempts DROP for fresh self-reporting sessions, then
live-verify the whole suite is green. The **interpret-fallback defer** tests
(fresh self-push suppresses interpret; stale/non-claude still interprets) ALREADY
EXIST and pass — see `describe('interpret fallback defers to fresh self-push')`
at `src/services/__tests__/session-summary-loop.test.ts:861-968` (landed with
commit `30c05f96`). Do NOT duplicate them; this leaf fills the remaining gap:
the nudge pass (`shouldSelfNudge` / `runSelfSummaryNudgePass`) has NO test today.

This is a TEST-ONLY leaf. No production code changes. The deterministic
`progressState` grading path must remain untouched (it already has thorough
coverage in `describe('runSessionSummaryTick')`); we only ADD test cases.

## Files

- **EDIT** `src/services/__tests__/session-summary-loop.test.ts` — add two new
  imports to the existing import block and append two `describe(...)` blocks.

No production files change.

## Real symbols under test (all already exported from `../session-summary-loop.ts`)

- `shouldSelfNudge(e, lastNudge, nowMs, intervalMs): boolean` — pure gate
  (`session-summary-loop.ts:1135`). Returns true ONLY when:
  - `e.progressState === 'quiet'` (skips active/stalled/wedged/unknown), AND
  - no parked question: NOT `e.structured?.question` and NOT
    `e.structured?.status === 'needs-input'`, AND
  - `nowMs - lastNudge >= intervalMs` (our re-nudge throttle), AND
  - `e.lastSelfPushAt == null || nowMs - e.lastSelfPushAt >= intervalMs`
    (skip if it self-pushed recently).
- `runSelfSummaryNudgePass(deps): Promise<{ scanned, eligible, nudged }>`
  (`session-summary-loop.ts:1169`). `deps: SelfSummaryNudgeDeps` =
  `{ listSummaries?, nudge?, config?, now? }`. Gating: `cfg.enabled===false` →
  returns `{ scanned:0, eligible:0, nudged:[] }` immediately. Otherwise iterates
  `listSummaries()`, gates each via `shouldSelfNudge` using the module-internal
  `lastSelfNudgeAt` map (keyed `${project}::${session}`), calls
  `nudge(project, session, text)`. Only a `'sent'` result advances the throttle
  clock and pushes to `nudged`; `'busy'`/`'no-tmux'` leave the clock untouched.
- `setSelfSummaryNudgeConfig({ enabled?, intervalMs? })` /
  `getSelfSummaryNudgeConfig()` (`:300-305`) — config knobs. NOTE
  `__resetSummaryState()` already clears `lastSelfNudgeAt` and re-reads the env
  defaults (`session-summary-loop.ts:252-254`), so each test starts clean.

### Test fixture shape

`SessionSummaryEntry` (`session-summary-loop.ts:79`). Minimal valid fixture for
the pure `shouldSelfNudge` tests — construct literals directly (no cache needed):

```ts
function entry(over: Partial<SessionSummaryEntry> = {}): SessionSummaryEntry {
  return {
    project: P, session: S, tmux: 'mc-alpha-worker-1',
    paneHash: 'h', paneSeenAt: 0, quietWindows: 1,
    progressState: 'quiet', updatedAt: 0,
    ...over,
  };
}
```

`InterpreterStructured.status` ∈ `'working' | 'idle' | 'stuck' | 'needs-input'`
(`session-summary-loop.ts:63`). For the parked-question case set
`structured: { paragraph: 'x', status: 'idle', question: 'Which way?' }`; for the
on-screen-prompt case set `structured: { paragraph: 'x', status: 'needs-input' }`.

## Change shape

### 1. Imports

In the existing `import { ... } from '../session-summary-loop.ts';` block (top of
the test file, currently lines 5-23) add:

```ts
  shouldSelfNudge,
  runSelfSummaryNudgePass,
  setSelfSummaryNudgeConfig,
  type SessionSummaryEntry,
```

(`getSelfSummaryNudgeConfig`, `pushSessionSummary`, `runSessionSummaryTick`,
`getSummaryHealth`, `__drainInterpreters`, `type InterpreterStructured`,
`type SummaryTickDeps` are already imported — reuse them.)

### 2. `describe('shouldSelfNudge (pure gate)')` — append near end of file

Cover each gate branch with `intervalMs = 5*60_000` and a `nowMs` well past it:

- **quiet + no question + never self-pushed + never nudged → true.**
  `shouldSelfNudge(entry(), -Infinity, 10*60_000, 5*60_000)` is `true`.
- **active → false.** `entry({ progressState: 'active' })` → false. Repeat for
  `'stalled'`, `'wedged'`, `'unknown'` (table-driven `for` over the four states).
- **parked open question → false.**
  `entry({ structured: { paragraph: 'x', status: 'idle', question: 'Q?' } })` → false.
- **on-screen prompt (status needs-input) → false.**
  `entry({ structured: { paragraph: 'x', status: 'needs-input' } })` → false.
- **re-nudge throttle → false.** `shouldSelfNudge(entry(), nowMs - 60_000, nowMs, 5*60_000)`
  with `nowMs = 10*60_000` → false (last nudge only 60s ago < intervalMs).
- **self-pushed recently → false.**
  `entry({ lastSelfPushAt: nowMs - 60_000 })`, `lastNudge=-Infinity` → false.
- **stale self-push (older than interval) → true.**
  `entry({ lastSelfPushAt: nowMs - 6*60_000 })` with `nowMs=10*60_000` → true.

### 3. `describe('runSelfSummaryNudgePass (pass orchestration)')` — append

Drive the pass entirely through injected deps (`listSummaries`, `nudge`, `config`,
`now`) — a mock nudge sender + a fixed clock. No tmux, no real cache mutation.

- **disabled config → no-op.** `config: () => ({ enabled: false, intervalMs: 5*60_000 })`
  with one eligible quiet entry and a spy `nudge`. Expect
  `{ scanned: 0, eligible: 0, nudged: [] }` and the nudge spy NOT called.
- **nudges ONLY quiet + no-pending-question + stale-self-push sessions.** Provide a
  mixed `listSummaries`: one `quiet` eligible; one `active`; one `quiet` with
  `structured.question` set; one `quiet` with `lastSelfPushAt: now` (fresh push).
  Spy `nudge` returns `'sent'`. Assert `eligible === 1`, `nudged === [S]`, and the
  nudge spy was called exactly once with the eligible session's `(project, session)`.
- **skips active and question-parked (explicit).** Same as above but assert the
  active session and the question-parked session were NEVER passed to `nudge`
  (filter the spy's recorded args).
- **`'busy'`/`'no-tmux'` does NOT advance the throttle → retried next pass.** One
  quiet eligible entry; `nudge` returns `'busy'` on pass 1. Assert `nudged === []`.
  Run the pass a SECOND time (same `now`) with `nudge` now returning `'sent'`;
  assert it nudges this time (`nudged === [S]`) — proving the clock wasn't advanced
  by the busy result. (Relies on `__resetSummaryState` in `beforeEach` having
  cleared `lastSelfNudgeAt`; both passes share one test body.)
- **`'sent'` advances the throttle → not re-nudged within interval.** `nudge`
  returns `'sent'`. Pass 1 nudges; pass 2 at the SAME `now()` → `nudged === []`
  (re-nudge throttle holds). Use `now: () => fixedT` for both.

Use a recorded-args spy:

```ts
const calls: Array<[string, string]> = [];
const nudge = async (p: string, s: string) => { calls.push([p, s]); return result; };
```

### 4. Health-drop assertion — extend the EXISTING fallback suite

The leaf asks to "confirm summary-health interpret attempts DROP for self-reporting
sessions." The existing test `'fresh self-push ⇒ no interpret fired'`
(`session-summary-loop.test.ts:862`) already proves zero interpret calls. ADD one
assertion to that same test (or a sibling test right after it) using
`getSummaryHealth({ now })`: because no interpret ran, no outcome is recorded, so
`getSummaryHealth({ now: withinWindow + 2 }).attempts` is `0`. (Record the health
BEFORE the self-push path if a baseline is needed; with `__resetSummaryState` in
`beforeEach` the outcomes ring starts empty, so a plain `attempts === 0` after the
two ticks is sufficient.) Keep it additive — do not alter the existing
`expect(interpretCallCount).toBe(0)` assertion.

### 5. Deterministic-path untouched (verification, not new code)

No change to `describe('runSessionSummaryTick')`. Its grading tests
(`session-summary-loop.test.ts:54-296`) ARE the regression guard for the
deterministic `progressState` path; the blueprint's job is to confirm they still
pass in the live run below. Do not edit them.

## Live verification

Run the targeted file (bun:test, deps-injection style — no SQLite contention since
each test isolates `MERMAID_DATA_DIR` via the existing `beforeEach`):

```bash
npm run test:ci -- src/services/__tests__/session-summary-loop.test.ts
```

Expect: all pre-existing tests still green (deterministic grading path untouched)
PLUS the new `shouldSelfNudge` and `runSelfSummaryNudgePass` cases passing. If the
runner needs the bun path explicitly, fall back to:

```bash
bun test src/services/__tests__/session-summary-loop.test.ts
```

Acceptance: the file passes with the new cases; zero production-file diffs
(`git diff --name-only` shows only the test file).

## Notes / gotchas

- `bun:test` deps-injection style is already established in this exact file — mirror
  `makeDeps(...)` / per-test closures; do NOT introduce vitest or jest mocks.
- `__resetSummaryState()` (in the file's `beforeEach`) clears both the summary
  `cache` AND the `lastSelfNudgeAt` throttle map and re-reads env config, so tests
  that call the pass twice in one body get a clean throttle clock per test — but
  NOT between the two passes inside a single test (that's the point of the
  busy-retry / sent-throttle cases).
- `runSelfSummaryNudgePass` reads `lastSelfNudgeAt` from module state (not
  injectable); that's why the throttle-advance tests run two passes in one test
  body rather than relying on cross-test state.
- Keep `now` fixed per assertion; `Date.now()` is the real clock only inside
  `pushSessionSummary`, which these nudge-pass tests do not depend on (they inject
  `lastSelfPushAt` directly on the fixture).

```json
{ "schemaVersion": 1, "estimatedFiles": 1, "estimatedTasks": 3,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/__tests__/session-summary-loop.test.ts"],
  "tasks": [
    { "id": "should-self-nudge-pure", "files": ["src/services/__tests__/session-summary-loop.test.ts"], "description": "Add describe('shouldSelfNudge (pure gate)') covering quiet/active/question/needs-input/throttle/recent-push/stale-push branches" },
    { "id": "run-nudge-pass", "files": ["src/services/__tests__/session-summary-loop.test.ts"], "description": "Add describe('runSelfSummaryNudgePass') with injected listSummaries/nudge/config/now: disabled no-op, mixed eligibility, busy-no-advance, sent-advance" },
    { "id": "health-drop-assert", "files": ["src/services/__tests__/session-summary-loop.test.ts"], "description": "Add getSummaryHealth attempts===0 assertion to the fresh-self-push fallback test; run test:ci to live-verify the full file" }
  ] }
```
