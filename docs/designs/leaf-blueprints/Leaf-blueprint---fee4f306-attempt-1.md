# Z7 — Sonnet interpreter summary loop (design-zen-mode Phase 4, KEYSTONE)

## Goal

Extend the Z2 structural heartbeat (`src/services/session-summary-loop.ts`) so that — behind
the existing `paneHash` change-gate — it makes an **interpreter** model call against the
configured `summary` node model (Z6; default alias `sonnet` → `claude-sonnet-4-6`). The model
reads the last ~100 pane lines plus any pending question and returns a structured verdict
`{ paragraph, status, question?, options?, recommended? }`. The result is persisted on the
in-memory `SessionSummaryEntry` and broadcast over the existing `session_summary_updated` WS
message (now carrying the text + structured fields). A frozen/wedged session costs **zero**
model calls because the change-gate skips the call when the pane hash is unchanged since the
last interpretation.

The structural pass (Z2) stays exactly as it is and continues to emit every tick synchronously.
The interpreter call is fired **async / fire-and-forget** (it can take up to ~120s) so it never
blocks the orchestrator tick; on completion it mutates the cache entry and emits a *second*
`session_summary_updated` carrying the text. One in-flight interpreter call per session.

## Architecture decisions (read before editing)

1. **Reuse the `JudgmentLLM` port, do NOT add a new SDK path.** `src/services/judgment-llm.ts`
   already exposes `makeJudgmentLLM(cfg: JudgmentConfig): JudgmentLLM` with a `.complete(system,
   user)` method and a hard `JUDGMENT_TIMEOUT_MS` (120s) bound on every provider path
   (keyed anthropic via `getSecret`, OR subscription `claude -p`). This is the same seam
   `grok-triage.ts` uses. The interpreter is a pure completion → this port is the right call
   surface. **Do not import `@ai-sdk/anthropic` / `resolveModel` / `generateObject` here** — that
   path needs a console API key and is heavier; the JudgmentLLM port already handles the
   key-via-`getSecret`-with-subscription-fallback story.

2. **Structured output via prompt-for-JSON + tolerant parse**, mirroring
   `grok-triage.ts:parseVerdict` (regex-extract the first `{...}` block, `JSON.parse`, validate,
   fail-open to `null`). JudgmentLLM returns a string; we do NOT have `generateObject` on this
   port. Use a Zod schema for shape validation (import `{ z } from 'zod'` like
   `src/agent/worker-core/schemas.ts`). On any parse/validation failure → treat as a model
   failure (see `stale-failing` below).

3. **Model/route resolution** — add a small resolver that reads the `summary` node-kind config:
   - Model: `listNodeProfileOverrides(project)['summary']?.model ?? NODE_PROFILE.summary.model`
     (= `'sonnet'`). Both already exist: `listNodeProfileOverrides` in
     `src/services/orchestrator-config.ts:219`, `NODE_PROFILE` in
     `src/services/leaf-executor.ts:303` (the `summary` row is `{ model: 'sonnet', allowedTools:
     'Read Grep Glob', effort: 'low' }` at `leaf-executor.ts:324`).
   - Provider/key: prefer the **keyed Anthropic** provider when `getSecret('ANTHROPIC_API_KEY')`
     is set (config.json authoritative — satisfies the spec's "Key via getSecret"), mapping the
     `'sonnet'` alias → `'claude-sonnet-4-6'`; otherwise fall back to the subscription `'claude'`
     provider (`claude -p`, same auth as the leaf-executor, no key needed) with model alias
     `'sonnet'` and `cwd` = the trusted project root. This mirrors the
     `anthropicAvailable()`-with-fallback principle in
     `src/agent/worker-core/resolve-model.ts:23` and the codebase rule "never hard-fail on a
     missing key." Net: a configured Anthropic key is used; without one it still works via the
     subscription CLI.
   - Build the `JudgmentConfig` accordingly and call `makeJudgmentLLM(cfg)`.

4. **Triggers collapse to one per-tick rule.** The three spec triggers (server-side idle/Stop,
   every ~2min while working, on pane change) all reduce to: *"the pane hash differs from the
   hash we last interpreted, AND we are past the throttle window, AND no call is in flight."*
   - Idle/Stop transition: when the agent stops, the spinner→prompt change mutates the pane →
     `paneHash` changes → the change-gate fires an interpret. No separate Stop signal needed.
   - Continual work: the throttle (`INTERPRET_MIN_INTERVAL_MS ≈ 120_000`) caps interpret calls to
     ~every 2 min even while the pane changes every 30s tick.
   - Pane change while idle is covered by the same hash compare.
   - **Wedged = zero cost**: pane hash unchanged since last interpret → no call, ever.

## Files to edit

### 1. `src/services/session-summary-loop.ts` (primary — all logic)

**Imports to add:**
```ts
import { z } from 'zod';
import { makeJudgmentLLM, type JudgmentConfig } from './judgment-llm.js';
import { listNodeProfileOverrides } from './orchestrator-config.js';
import { NODE_PROFILE } from './leaf-executor.js';
import { getSecret } from './config-service.js';
import { listOpenEscalations } from './supervisor-store.js';
```
(Note: `detectPermissionPrompt` is already imported at line 26 — reuse it for the in-pane
question fallback.)

**Extend the entry type** (`SessionSummaryEntry`, line 36) with the interpreter fields, all
optional so the structural-only path is unchanged:
```ts
  /** Last interpreted summary text (the model's paragraph), if any. */
  text?: string;
  /** First sentence/clause of `text` (cheap headline for the Zen FocusCard). */
  firstClause?: string;
  /** Wall-clock when the interpreter summary last landed. */
  summaryUpdatedAt?: number;
  /** The structured interpreter verdict (status/question/options/recommended). */
  structured?: SessionInterpretation;
  /** The paneHash that the current `text`/`structured` describes. Drives the change-gate:
   *  if paneHash !== interpretedPaneHash, the next eligible tick re-interprets. */
  interpretedPaneHash?: string;
  /** 'fresh' after a successful land; 'stale-failing' when the pane changed but the model
   *  call failed / produced no parseable verdict so the displayed summary is now stale. */
  refreshState?: 'fresh' | 'stale-failing';
```

**Add the structured schema + type** (near the top types block):
```ts
export const SessionInterpretationSchema = z.object({
  paragraph: z.string(),
  status: z.enum(['working', 'idle', 'stuck', 'needs-input']),
  question: z.string().optional(),
  options: z.array(z.object({ label: z.string(), valueToSend: z.string() })).optional(),
  recommended: z.number().int().optional(),
});
export type SessionInterpretation = z.infer<typeof SessionInterpretationSchema>;
```

**Add module-level interpreter state** (alongside `cache`):
```ts
const interpretInFlight = new Set<string>(); // keys with a model call in flight (one per session)
const INTERPRET_MIN_INTERVAL_MS = 120_000;   // ~2min throttle while continually working
```
Reset `interpretInFlight.clear()` inside `__resetSummaryState()` (line 61) so tests start clean.

**Extend `SummaryTickDeps`** (line 90) with two injectable seams so the model call is testable
without a live LLM:
```ts
  interpret?: (input: {
    project: string; session: string; cwd: string; pane: string; pendingQuestion?: string;
  }) => Promise<SessionInterpretation | null>;
  openEscalations?: () => Array<{ project: string; session: string; questionText: string }>;
```
Default `interpret` = the real implementation below; default `openEscalations` = a thin wrapper
over `listOpenEscalations()` projecting `{ project, session, questionText }`.

**The real interpreter** (new internal `async function interpretSession(...)`, default for
`deps.interpret`):
- Resolve route: `model = listNodeProfileOverrides(project)['summary']?.model ?? NODE_PROFILE.summary.model`.
- `const key = getSecret('ANTHROPIC_API_KEY');`
  - if `key`: `cfg = { provider: 'anthropic', model: model === 'sonnet' ? 'claude-sonnet-4-6' : model, apiKey: key }`.
  - else: `cfg = { provider: 'claude', model, apiKey: '', cwd }` (subscription `claude -p`).
- `const llm = makeJudgmentLLM(cfg);`
- Build system + user prompts (below). `const raw = await llm.complete(system, user);`
- Parse: regex `raw.match(/\{[\s\S]*\}/)`; `JSON.parse`; `SessionInterpretationSchema.safeParse`.
  On any failure return `null` (caller maps to `stale-failing`). Clamp `recommended` to a valid
  `options` index (drop if out of range). Wrap the whole body in try/catch → return `null` on
  throw (timeout, network, non-OK status all surface here).

**System prompt** (verbatim discipline from the spec — bake these guards in):
> You are the INTERPRETER for a calm "Zen mode" view of an autonomous coding session. You are
> shown the last ~100 lines of a terminal pane and (optionally) a pending question the agent is
> waiting on. Describe the session's STATE, not live action. Write 3–5 sentences. If the pane is
> ambiguous, say "unclear from the pane" rather than confabulate — NEVER invent file names,
> errors, or progress you cannot see. Respond with ONLY a JSON object, no prose, no code fence:
> `{"paragraph": "...", "status": "working|idle|stuck|needs-input", "question": "<verbatim or
> paraphrased ask, omit if none>", "options": [{"label":"...","valueToSend":"..."}], "recommended":
> <index into options>}`. Include `question`/`options`/`recommended` ONLY when the agent is
> actually waiting on a human choice.

**User prompt**: the pane text (last ~100 lines as captured) and, when present, the pending
question. Pending question source order: (a) an open escalation for this `(project, session)`
from `deps.openEscalations()`'s `questionText`; else (b) `detectPermissionPrompt(pane)` when
`.isPermission` (use its detected prompt text). Pass `pendingQuestion` into the call so the
model can echo/structure it.

**Wire the trigger into `runSessionSummaryTick`** — at the END of the per-session loop body
(after the structural `entry` is built and cached at line ~289, BEFORE/AROUND the structural
broadcast at line 291), decide whether to fire an interpret. Only on the *normal* captured-pane
path (NOT the `!wsPresent()` / `pane === ''` early-continue branches — those leave the
interpreter fields untouched and never spend a call). Logic:
```ts
const interpretFn = deps.interpret ?? interpretSession;
const openEsc = deps.openEscalations ?? defaultOpenEscalations;
// change-gate + throttle + single-flight
const changedSinceInterpret = prev?.interpretedPaneHash !== hash;
const throttleOk = !prev?.summaryUpdatedAt || (ts - prev.summaryUpdatedAt) >= INTERPRET_MIN_INTERVAL_MS;
const eligible = wsPresent() && hash !== '' && changedSinceInterpret && throttleOk
                 && !interpretInFlight.has(key);
```
Carry forward the prior interpreter fields onto the freshly-built `entry` (so a tick that does
NOT interpret keeps showing the last text):
```ts
entry.text = prev?.text;
entry.firstClause = prev?.firstClause;
entry.summaryUpdatedAt = prev?.summaryUpdatedAt;
entry.structured = prev?.structured;
entry.interpretedPaneHash = prev?.interpretedPaneHash;
entry.refreshState = changedSinceInterpret && prev?.text ? 'stale-failing' : prev?.refreshState;
```
(That last line marks an existing summary stale the moment the pane moves past it; a successful
interpret below flips it back to `'fresh'`.)

Then, when `eligible`, fire-and-forget (do NOT await inside the tick loop):
```ts
if (eligible) {
  interpretInFlight.add(key);
  const cwd = launchProject ?? project;
  const pendingQuestion = derivePendingQuestion(project, session, pane, openEsc); // esc → permission-prompt
  void interpretFn({ project, session, cwd, pane, pendingQuestion })
    .then((structured) => {
      const cur = cache.get(key);
      if (!cur) return; // session pruned mid-flight
      const landedAt = now();
      if (structured) {
        cur.text = structured.paragraph;
        cur.firstClause = firstClauseOf(structured.paragraph);
        cur.structured = structured;
        cur.interpretedPaneHash = hash;     // the hash this summary describes
        cur.summaryUpdatedAt = landedAt;
        cur.refreshState = 'fresh';
      } else {
        cur.refreshState = 'stale-failing'; // model failed / unparseable
      }
      cur.updatedAt = landedAt;
      cache.set(key, cur);
      broadcast(summaryWsPayload(cur)); // second emit carrying text + structured
    })
    .catch(() => {
      const cur = cache.get(key);
      if (cur) { cur.refreshState = 'stale-failing'; cur.updatedAt = now(); broadcast(summaryWsPayload(cur)); }
    })
    .finally(() => { interpretInFlight.delete(key); });
}
```
Helpers to add: `firstClauseOf(text)` (first sentence up to `.`/`?`/`!` or first ~120 chars);
`derivePendingQuestion(...)` (escalation `questionText` for this session → else permission-prompt
text → else undefined); `summaryWsPayload(entry)` building the WS object including the new fields.

**Update the structural broadcast** at line 291 (and the two early-continue broadcasts at 196 &
218) to flow through `summaryWsPayload(entry)` so every emit shape is consistent and includes
whatever interpreter fields are present (they'll just be absent on the unknown/capture-fail
paths). Keep the existing `progressState`/`paneSeenAt`/`updatedAt` fields.

### 2. `src/websocket/handler.ts` (extend the WS message type)

Extend the `session_summary_updated` variant (lines 112–114) with the optional interpreter
fields so the Zen UI (Z1 FocusCard / VerdictBar) can consume them. Additive, all optional:
```ts
  | { type: 'session_summary_updated'; project: string; session: string;
      progressState: 'active' | 'quiet' | 'stalled' | 'wedged' | 'unknown';
      paneSeenAt: number; updatedAt: number;
      text?: string; firstClause?: string; summaryUpdatedAt?: number;
      structured?: { paragraph: string; status: 'working' | 'idle' | 'stuck' | 'needs-input';
                     question?: string; options?: Array<{ label: string; valueToSend: string }>;
                     recommended?: number };
      refreshState?: 'fresh' | 'stale-failing' }
```

### 3. `src/services/__tests__/session-summary-loop.test.ts` (extend tests)

Add cases using the injectable `deps.interpret` / `deps.openEscalations` seams (no live LLM):
- **change-gate / wedged = zero cost**: same pane hash across ticks after a first interpret →
  `interpret` spy called exactly once; a frozen session never calls it again.
- **fires on pane change**: changed hash + elapsed throttle → `interpret` called; resolves to a
  structured verdict → entry gets `text`/`firstClause`/`structured`/`refreshState:'fresh'` and a
  second `broadcast` carries them.
- **throttle**: changed hash but within `INTERPRET_MIN_INTERVAL_MS` of last `summaryUpdatedAt` →
  not called.
- **single-flight**: a slow (never-resolving) `interpret` → a second tick does not call it again.
- **stale-failing**: `interpret` resolves `null` (or rejects) after the pane moved past the last
  summary → `refreshState === 'stale-failing'`, prior `text` retained.
- **no model call on `!wsPresent()` / capture-fail** branches.
- **pending question plumbing**: `deps.openEscalations` returning a matching escalation →
  `pendingQuestion` passed into `interpret`.

Use a controllable `now` (already a dep) to drive the throttle window deterministically.

## Invariants / guards (do not regress)

- The structural Z2 state machine and its synchronous per-tick emit are unchanged; interpreter
  fields are strictly additive and optional.
- The model call NEVER runs synchronously inside the tick (fire-and-forget) — the orchestrator
  tick must not block on a ≤120s LLM call.
- Change-gate first: no model call when `paneHash === interpretedPaneHash`. Wedged/frozen
  sessions therefore spend zero tokens.
- One in-flight interpret per session (`interpretInFlight` set), cleared in `.finally`.
- Fail-open everywhere: any parse/validation/timeout/throw → `null` → `refreshState:'stale-failing'`,
  prior text retained, never a thrown tick.
- Key resolution honors config.json via `getSecret('ANTHROPIC_API_KEY')`; missing key falls back
  to the subscription `claude -p` path (no hard-fail).

## Build / verify

`npm run test:ci -- src/services/__tests__/session-summary-loop.test.ts` plus `tsc` (the WS-type
and entry-type changes must compile against `src/services/coordinator-live.ts` and any Z1 UI
consumer of `session_summary_updated`).

```json
{ "schemaVersion": 1, "estimatedFiles": 3, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "src/services/session-summary-loop.ts",
    "src/websocket/handler.ts",
    "src/services/__tests__/session-summary-loop.test.ts"
  ],
  "tasks": [
    { "id": "entry-and-schema", "files": ["src/services/session-summary-loop.ts"], "description": "Add SessionInterpretationSchema/type, extend SessionSummaryEntry with text/firstClause/summaryUpdatedAt/structured/interpretedPaneHash/refreshState, add interpretInFlight set + INTERPRET_MIN_INTERVAL_MS, reset in __resetSummaryState" },
    { "id": "interpreter-call", "files": ["src/services/session-summary-loop.ts"], "description": "Add interpretSession (route resolution via NODE_PROFILE/listNodeProfileOverrides + getSecret key-or-subscription, makeJudgmentLLM, prompt build, tolerant JSON+Zod parse) plus derivePendingQuestion/firstClauseOf/summaryWsPayload helpers" },
    { "id": "tick-trigger", "files": ["src/services/session-summary-loop.ts"], "description": "Wire change-gate+throttle+single-flight eligibility into runSessionSummaryTick, carry-forward prior interpreter fields, fire-and-forget interpret with second broadcast on land, route all emits through summaryWsPayload; extend SummaryTickDeps with interpret/openEscalations seams" },
    { "id": "ws-type-and-tests", "files": ["src/websocket/handler.ts", "src/services/__tests__/session-summary-loop.test.ts"], "description": "Extend session_summary_updated WS message with optional interpreter fields; add tests for change-gate/zero-cost, fire-on-change, throttle, single-flight, stale-failing, ws-gap no-call, pending-question plumbing" }
  ] }
```
