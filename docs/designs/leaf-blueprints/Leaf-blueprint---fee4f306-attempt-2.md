# Blueprint — Z7: Sonnet interpreter summary loop (design-zen-mode Phase 4, KEYSTONE)

## Goal

Extend the existing **structural** session-summary loop (Z2,
`src/services/session-summary-loop.ts`) so that — behind a strict change-gate +
throttle + single-in-flight guard — it also calls the configured `summary` node
model (Z6; default `claude-sonnet-4-6`, alias `sonnet`) to produce an
**interpreter** pass: a structured `{ paragraph, status, question?, options?,
recommended? }`. Persist it onto the cache entry and emit an enriched
`session_summary_updated`. A frozen (wedged) session must cost **zero** model
calls — the change-gate guarantees this.

This is additive: the deterministic structural state machine (active/quiet/
stalled/wedged/unknown) is unchanged and keeps emitting every tick. The
interpreter is a slow, async, fire-and-forget side-channel that emits a SECOND
(enriched) `session_summary_updated` when it lands.

---

## Background — what already exists (cite)

- **`src/services/session-summary-loop.ts`** — `runSessionSummaryTick(deps)` (line 127).
  - In-memory `cache: Map<string, SessionSummaryEntry>` keyed `${project}::${session}` (line 51).
  - `SessionSummaryEntry` (line 36): `{ project, session, tmux, paneHash, paneSeenAt, quietWindows, progressState, updatedAt }`.
  - `SummaryTickDeps` injectable seam (line 90) — every external dep is overridable for tests.
  - Per-row flow: capture pane (`capture`, 100 lines), `createHash('sha1')` → `hash`, `changed = !prev || prev.paneHash !== hash` (line 224-225), grade `progressState`, `cache.set`, `broadcast({ type:'session_summary_updated', ... })` (line 291).
  - `__resetSummaryState()` (line 61) clears cache + thresholds — tests call it in `beforeEach`.
  - Exports `getSessionSummary`, `listSessionSummaries`.
- **`src/agent/node-invoker.ts`** — `invokeNode(spec: NodeSpec): Promise<NodeResult>` (line 384). Subscription-only `claude -p`, bounded/un-hangable (SIGTERM→SIGKILL escalation, drain cap). `NodeSpec` (line 37) takes `{ prompt, model, allowedTools, appendSystemPrompt, cwd, timeoutMs, effort, permissionMode }`. `NodeResult.text` (line 95) is the parsed final assistant text. `RATE_LIMIT_RE`/`unreachable`/`ok` semantics already handled. **This is the SDK seam we reuse** (the codebase runs nodes under the claude.ai subscription, never an API key — `assertSubscriptionAuth`).
- **`src/services/leaf-executor.ts`** — `NODE_PROFILE.summary = { model: 'sonnet', allowedTools: 'Read Grep Glob', effort: 'low' }` (line 324). Z6 added the `summary` `LeafNodeKind` (line 44).
- **`src/services/orchestrator-config.ts`** — `listNodeProfileOverrides(project)` (line 219) returns `Record<kind, { model: string|null, effort: EffortLevel|null }>`. `getProjectEffort(project)` (line 188). This is exactly how `leaf-executor.ts:865-869` resolves the per-project model/effort for a node kind.
- **`src/services/config-service.ts`** — `getSecret(key, fallback?)` (line 51): config.json-authoritative read (file → env → fallback). Used only if we ever wire a keyed Anthropic provider; the **default subscription path needs no key** (see §Auth note).
- **`src/websocket/handler.ts`** — `WSMessage` union member `session_summary_updated` (line 112): `{ type; project; session; progressState; paneSeenAt; updatedAt }`. Must be extended.
- **UI** — `ui/src/stores/supervisorStore.ts`: `SessionSummary` interface (line 237), `ingestSessionSummary` (line 547). `ui/src/hooks/useStatusSync.ts`: `session_summary_updated` case (line 85) builds the `ingestSessionSummary` payload. Both must carry the new structured fields through.

---

## Design

### Interpreter trigger / gate (the keystone discipline)

Per cache entry, track the pane hash the **last summary** was computed from
(`summaryPaneHash`), the last summary timestamp (`lastSummaryAt`), and a
single-in-flight flag (`summaryInFlight`).

Fire an interpreter call this tick iff **all** of:
1. `wsPresent()` and `pane !== ''` (we have a real, fresh pane — same guards the structural pass uses).
2. `!entry.summaryInFlight` (one in-flight call per session).
3. `hash !== entry.summaryPaneHash` (**change-gate**: pane changed since the last summary — a frozen/wedged session has `hash === summaryPaneHash` ⇒ never re-calls ⇒ zero cost).
4. EITHER
   - `now - (prev.lastSummaryAt ?? 0) >= MIN_SUMMARY_INTERVAL_MS` (throttle ≥ 45s; covers both "every ~2min while working" — because each working tick changes the pane but throttle limits to ~1/45s — and "on pane change"), OR
   - **became-idle edge**: previous state was `active`/`quiet`-while-changing and this tick graded `quiet`/`stalled` (a Stop / idle transition) AND change-gate (3) holds. The became-idle edge BYPASSES the throttle so the final state-of-rest summary always lands.

(`MIN_SUMMARY_INTERVAL_MS = 45_000`; tick cadence is ~30s, so most ticks no-op the model.)

### Calling the model (interpreter pass)

A new injectable dep `interpret` (defaulting to a real implementation that calls
`invokeNode`):

```ts
interpret?: (args: {
  project: string; session: string; pane: string;
  pendingQuestion: string | null; model: string; effort: EffortLevel;
}) => Promise<InterpreterStructured | null>;  // null = call failed / unparseable
```

Default impl (`interpretViaNode`):
- Resolve model/effort: `const ov = listNodeProfileOverrides(project).summary; model = ov?.model ?? NODE_PROFILE.summary.model; effort = ov?.effort ?? getProjectEffort(project) ?? NODE_PROFILE.summary.effort` (mirror `leaf-executor.ts:867-869`). Import `NODE_PROFILE` from `leaf-executor.ts` and the two config getters from `orchestrator-config.ts`.
- Build prompt: the system/append-system-prompt holds the INTERPRETER contract (below); the user prompt (stdin) is the last ~100 pane lines + any `pendingQuestion`.
- `invokeNode({ prompt, model, effort, allowedTools: '', appendSystemPrompt: SYSTEM, cwd: project, permissionMode: 'bypassPermissions', timeoutMs: INTERPRETER_TIMEOUT_MS })` — `allowedTools: ''` ⇒ pure completion, no tools (the model only reads the pane text we hand it; it does NOT need Read/Grep — `NODE_PROFILE.summary.allowedTools` is for the leaf-node variant). `cwd = project` so the subscription CLI trusts the folder (same as `judgment-llm.ts` makeClaudeSubscription).
- On `!result.ok` (incl. rateLimited/unreachable/timeout) → return `null`.
- Else `JSON.parse` the text (strip ```json fences first — reuse a tiny local `stripFences`), validate shape, coerce, return `InterpreterStructured` or `null` on parse failure.

INTERPRETER_TIMEOUT_MS = 60_000 (a summary is short; never let it span more than one tick-and-a-bit).

### System prompt contract (verbatim intent — embed as a const string)

> You are a calm session interpreter. You are given the last ~100 lines of a
> terminal pane from one Claude Code worker session, and optionally a pending
> question it is asking. Describe the **state** of the session, NOT live action.
> Reply with ONE JSON object and nothing else:
> `{ "paragraph": string (3-5 sentences describing the STATE; if the pane is
> ambiguous say "unclear from the pane" rather than confabulate), "status":
> "working"|"idle"|"stuck"|"needs-input", "question"?: string (the verbatim or
> lightly paraphrased ask, only if it is waiting on a human), "options"?:
> [{"label": string, "valueToSend": string}], "recommended"?: integer (index
> into options) }`. Never invent progress that is not visible in the pane.

### Structured type

```ts
export interface InterpreterStructured {
  paragraph: string;
  status: 'working' | 'idle' | 'stuck' | 'needs-input';
  question?: string;
  options?: Array<{ label: string; valueToSend: string }>;
  recommended?: number;
}
export type RefreshState = 'fresh' | 'stale-failing';
```

Validation/coercion in the default `interpret`: require `paragraph` non-empty
string + `status` ∈ the 4 literals (else return null). `question` only kept if
string; `options` only kept if array of `{label,valueToSend}` strings;
`recommended` only kept if an in-range integer index.

### Persisting + the second emit

Extend `SessionSummaryEntry` with optional interpreter fields:
`summaryText?: string` (= paragraph), `firstClause?: string` (first sentence/
clause of paragraph — `paragraph.split(/(?<=[.!?])\s/)[0]` truncated ~80 chars,
for the Zen pills), `structured?: InterpreterStructured`, `summaryUpdatedAt?:
number`, `summaryPaneHash?: string`, `lastSummaryAt?: number`,
`summaryInFlight?: boolean`, `refreshState?: RefreshState`.

Flow inside the row loop (AFTER the existing structural `cache.set` + structural
`broadcast`):

```ts
if (shouldSummarize(entry, hash, now)) {
  entry.summaryInFlight = true;
  entry.lastSummaryAt = now;            // stamp at LAUNCH so throttle counts attempts, not completions
  cache.set(key, entry);
  const p = (async () => {
    const pendingQuestion = isWaiting(pane) ? extractPendingQuestion(pane) : null;
    let structured: InterpreterStructured | null = null;
    try { structured = await interpret({ project, session, pane, pendingQuestion, model, effort }); }
    catch { structured = null; }
    const cur = cache.get(key);
    if (!cur) return;                    // session pruned mid-call — drop
    cur.summaryInFlight = false;
    if (structured) {
      cur.structured = structured;
      cur.summaryText = structured.paragraph;
      cur.firstClause = firstClauseOf(structured.paragraph);
      cur.summaryPaneHash = hash;        // mark THIS pane as summarized → change-gate closes until pane moves
      cur.summaryUpdatedAt = now();
      cur.refreshState = 'fresh';
    } else {
      // model failure / pane-changed-but-summary-didn't-land
      cur.refreshState = 'stale-failing';
      // NB: do NOT advance summaryPaneHash → a later tick will retry once throttle clears.
    }
    cache.set(key, cur);
    broadcast(enrichedMsg(cur));         // SECOND emit, now carrying structured + refreshState
  })();
  trackInterpreter(p);                   // module-level Set for test draining
}
```

`enrichedMsg(entry)` = the existing `session_summary_updated` payload PLUS
`{ summaryText, firstClause, structured, summaryUpdatedAt, refreshState }`.

Also enrich the **structural** broadcast each tick to include any
already-present `entry.summaryText/structured/refreshState/summaryUpdatedAt`
(so a reconnecting client gets the last summary on the next structural tick, not
only on the rare interpreter landing). Add a small `summaryFields(entry)` helper
and spread it into every `broadcast({ type:'session_summary_updated', ... })`
call site (there are 3: WS-gap line ~196, capture-fail line ~218, normal line ~291).

### `refreshState: 'stale-failing'` precision

Set `stale-failing` when: an interpreter call returned `null` (model error /
unparseable) **OR** the pane has changed (`hash !== summaryPaneHash`) but no
summary has landed for it yet and the last attempt failed. Cleared to `'fresh'`
on a successful landing. Frozen sessions stay at whatever they last were (no new
call) — they are NOT `stale-failing`, they are simply not refreshing.

### Test seam additions to `SummaryTickDeps`

- `interpret?` (above) — tests inject a synchronous-resolving stub.
- `summaryModel?: (project) => { model: string; effort: EffortLevel }` — optional override of the model/effort resolution so a test need not touch the config DB (default reads `listNodeProfileOverrides`/`getProjectEffort`).
- Export `__drainInterpreters(): Promise<void>` (awaits the module-level in-flight Set) and clear that Set + the new entry fields in `__resetSummaryState()`.
- Add `MIN_SUMMARY_INTERVAL_MS`/`INTERPRETER_TIMEOUT_MS` as module consts; optionally allow tests to set the interval via a setter mirroring `setSummaryThresholds` (nice-to-have, not required — tests can drive `now()`).

---

## Exact changes by file

### 1. `src/services/session-summary-loop.ts` (primary)
- New imports: `invokeNode` from `../agent/node-invoker.js`; `NODE_PROFILE` from `./leaf-executor.js`; `listNodeProfileOverrides`, `getProjectEffort` from `./orchestrator-config.js`; `EffortLevel` type.
- Add `InterpreterStructured`, `RefreshState` types + extend `SessionSummaryEntry` with the optional interpreter fields.
- Add consts `MIN_SUMMARY_INTERVAL_MS = 45_000`, `INTERPRETER_TIMEOUT_MS = 60_000`, the `INTERPRETER_SYSTEM` prompt string.
- Add helpers: `firstClauseOf`, `stripFences`, `extractPendingQuestion` (use `detectPermissionPrompt(pane)` — already imported — to pull the prompt text; fallback to last non-empty line), `interpretViaNode` (default `interpret`), `shouldSummarize`, `summaryFields`, module-level `inFlightInterpreters: Set<Promise<void>>` + `trackInterpreter` + `__drainInterpreters`.
- Extend `SummaryTickDeps` with `interpret?` and `summaryModel?`.
- Wire model/effort resolution + the launch-block into the row loop after the structural broadcast; spread `summaryFields(entry)` into all 3 broadcast call sites.
- Extend `__resetSummaryState` to clear the in-flight set (cache.clear already drops entries).

### 2. `src/websocket/handler.ts`
- Extend the `session_summary_updated` union member (line 112-114) with optional fields:
  `summaryText?: string; firstClause?: string; summaryUpdatedAt?: number; refreshState?: 'fresh'|'stale-failing'; structured?: { paragraph: string; status: 'working'|'idle'|'stuck'|'needs-input'; question?: string; options?: Array<{label:string;valueToSend:string}>; recommended?: number }`.

### 3. `ui/src/stores/supervisorStore.ts`
- Extend `SessionSummary` (line 237) with the same optional fields (`summaryText`, `firstClause`, `summaryUpdatedAt`, `refreshState`, `structured`). Reuse/define a `ZenStructured` type matching the server shape.
- Extend `ingestSessionSummary` param type (line 414) + body (line 547) to fold the new fields (preserve existing `snoozedUntil`; carry forward prior `structured` if a structural-only update arrives with none).

### 4. `ui/src/hooks/useStatusSync.ts`
- In the `session_summary_updated` case (line 85-99), read the new optional fields off `msg` and pass them into `ingestSessionSummary` (guard types like the existing ones; default missing structured to undefined).

### 5. `src/services/__tests__/session-summary-loop.test.ts`
- Add a `describe('interpreter pass')` block using `makeDeps` + injected `interpret`/`summaryModel`:
  - **fires on pane change + throttle elapsed**: seed, change pane, advance `now` past 45s ⇒ `interpret` called once; `__drainInterpreters()`; entry has `structured`, `summaryText`, `summaryPaneHash===hash`, `refreshState==='fresh'`; a second enriched broadcast carrying `structured` was emitted.
  - **frozen session = zero calls (KEYSTONE)**: same pane across many ticks past wedge ⇒ `interpret` never called after the first summary (assert call count).
  - **throttle**: pane changes every tick but within 45s ⇒ at most one call.
  - **became-idle edge bypasses throttle**: active→quiet transition with changed pane within throttle ⇒ one call.
  - **single in-flight**: `interpret` returns a never-resolving promise; a second tick does not launch a second call (assert count===1).
  - **failure → stale-failing**: `interpret` resolves null ⇒ `refreshState==='stale-failing'`, `summaryPaneHash` NOT advanced, a later throttle-cleared tick retries.

---

## Auth note (why subscription, not a key)

Nodes in this codebase run under the claude.ai **subscription** via `claude -p`
(`node-invoker.ts` `assertSubscriptionAuth` is fail-closed; it refuses to spawn
under an API key). The Z7 interpreter reuses `invokeNode`, so the default path
needs **no** `ANTHROPIC_API_KEY`. The `getSecret` (config.json-authoritative)
note in the spec applies to any future keyed-provider alternative (the
`judgment-llm.ts` `makeAnthropic` seam already shows the pattern); it is NOT
needed for the default subscription path and is intentionally out of scope here.
Keep the `interpret` dep injectable so a keyed provider can be swapped in later
without touching the gate logic.

## Verification
- `npm run test:ci -- src/services/__tests__/session-summary-loop.test.ts` (bun:test file) — new + existing pass.
- `bun run tsc` (typecheck) — server union + UI types compile.
- Manual sanity: a frozen pane logs zero `invokeNode` spawns (the keystone cost guarantee).

```json
{ "schemaVersion": 1, "estimatedFiles": 5, "estimatedTasks": 5,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "src/services/session-summary-loop.ts",
    "src/websocket/handler.ts",
    "ui/src/stores/supervisorStore.ts",
    "ui/src/hooks/useStatusSync.ts",
    "src/services/__tests__/session-summary-loop.test.ts"
  ],
  "tasks": [
    { "id": "loop-interpreter", "files": ["src/services/session-summary-loop.ts"], "description": "Add interpreter pass: types, gate (change-gate+throttle+single-in-flight+became-idle), interpretViaNode via invokeNode with per-project summary model/effort, second enriched emit, refreshState, drain helper" },
    { "id": "ws-message", "files": ["src/websocket/handler.ts"], "description": "Extend session_summary_updated WSMessage union with summaryText/firstClause/summaryUpdatedAt/refreshState/structured" },
    { "id": "store", "files": ["ui/src/stores/supervisorStore.ts"], "description": "Extend SessionSummary + ingestSessionSummary to carry/preserve structured interpreter fields" },
    { "id": "status-sync", "files": ["ui/src/hooks/useStatusSync.ts"], "description": "Pass new structured fields from session_summary_updated through to ingestSessionSummary" },
    { "id": "tests", "files": ["src/services/__tests__/session-summary-loop.test.ts"], "description": "Interpreter-pass tests: fires-on-change+throttle, frozen=zero-calls keystone, throttle, became-idle bypass, single-in-flight, failure→stale-failing" }
  ] }
```
