# Implementation Blueprint — break the debounce deadlock + harden planner JSON parse

## Context grounded

**BUG A** lives in `src/services/conductor-pass.ts`, `runConductorPassInner`:
- Line 214: `const fp = conductorFingerprint(status, actions) + \`|land:${landCards}\`;`
- Line 215: `if (target.row.lastConductorKey === fp) return { ran: false, reason: 'debounced', missionId };`
- Lines 234–236: the fatal comment + unconditional `stampConductorRun(project, missionId, fp)` — stamps the *same plain* `fp` whether the node succeeded or failed. A failed serve leaves state identical (0 epics), so next tick recomputes the *same* `fp`, matches at line 215, and returns `'debounced'` forever. Permanent wedge.

`stampConductorRun(project, todoId, key)` (`src/services/mission-store.ts:263`) is a plain `UPDATE mission SET lastConductorKey = ?`; `lastConductorKey` is surfaced on the mission row (`mission-store.ts:59,245`). No schema change needed — the fail counter rides inside the existing TEXT column.

**BUG B** lives in `src/mcp/tools/mission-planner.ts`:
- `parseEpicSpec` (lines 66–94): when there's no fence it does `indexOf('{')` / `lastIndexOf('}')` slice (lines 71–73) then a single `JSON.parse` (line 76). A `}` inside a string value mis-slices; a truncated emission ("Unterminated string") is indistinguishable from garbage and throws with no recovery.
- `planMissionCriterion` calls `parseEpicSpec(res.text)` exactly once at line 154 with no retry.

Test conventions: `bun:test`; conductor tests use an injectable `invoke` (`okInvoke` returns `{ ok: true }`); planner tests call `parseEpicSpec` directly and use `mockInvoke(spec)`.

---

## Change 1 — `src/services/conductor-pass.ts` (BUG A: bounded-retry, no permanent wedge)

**1a. Add a retry-cap constant** near `CRITERION_SERVE_CAP_KIND` (~line 38):
```ts
/** A failed conductor serve stamps `${fp}|fail:N`; after this many consecutive failures at the
 *  SAME fingerprint the pass stops retrying (no permanent wedge, no infinite opus-node thrash).
 *  A state change (new fp) resets the counter to 0. */
export const CONDUCTOR_SERVE_RETRY_CAP = 3;
```

**1b. Add a pure helper** (exported, for the test) that reads the prior consecutive-failure count for a given fp out of `lastConductorKey`:
```ts
/** How many consecutive failures have been stamped for THIS fingerprint. A plain `fp` (success) or a
 *  different fp (state moved) ⇒ 0. `${fp}|fail:N` ⇒ N. */
export function conductorFailCount(lastKey: string | null, fp: string): number {
  if (!lastKey || !lastKey.startsWith(fp + '|fail:')) return 0;
  const n = Number.parseInt(lastKey.slice((fp + '|fail:').length), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
```
(`startsWith(fp + '|fail:')` is unambiguous: `fp` already ends in `|land:${n}`, and a plain-success stamp equals `fp` exactly, so it can't collide with the `|fail:` suffix.)

**1c. Rewrite the debounce gate** (lines 214–215) to distinguish success-debounce from cap-debounce:
```ts
const fp = conductorFingerprint(status, actions) + `|land:${landCards}`;
// Success at this exact state ⇒ never respin. On failure we stamp a bounded `${fp}|fail:N`
// counter instead, so a failed serve retries until CONDUCTOR_SERVE_RETRY_CAP, then stops —
// never the permanent 'debounced' wedge a plain-fp stamp caused.
if (target.row.lastConductorKey === fp) return { ran: false, reason: 'debounced', missionId };
const failCount = conductorFailCount(target.row.lastConductorKey, fp);
if (failCount >= CONDUCTOR_SERVE_RETRY_CAP) return { ran: false, reason: 'debounced', missionId };
```

**1d. Rewrite the stamp** (lines 234–236): stamp the plain `fp` ONLY on success; on failure stamp the incremented `${fp}|fail:N` counter:
```ts
// Success ⇒ stamp the plain fp (never respin identical state). Failure ⇒ stamp a bounded
// `${fp}|fail:N` counter so we retry up to CONDUCTOR_SERVE_RETRY_CAP, then stop — no wedge.
stampConductorRun(project, missionId, res.ok ? fp : `${fp}|fail:${failCount + 1}`);
return { ran: true, reason: res.ok ? 'conducted' : 'node-failed', missionId, modelUsed: model, escalationsRaised };
```

---

## Change 2 — `src/mcp/tools/mission-planner.ts` (BUG B: balanced extract + repair retry)

**2a. Add `extractBalancedJsonObject`** (exported) — string/escape-aware brace scan; `null` on truncation:
```ts
/** Scan for the first balanced top-level `{...}` object, tracking string/escape state so a `}` inside
 *  a string value never closes the object. Returns null if the object is truncated (depth never
 *  returns to 0) — that distinguishes a cut-off emission from real garbage so the caller can repair-retry. */
export function extractBalancedJsonObject(text: string): string | null {
  const s = text ?? '';
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null; // unterminated — truncated emission
}
```

**2b. Rewrite `parseEpicSpec`** (lines 66–78) to use the balanced extractor. Keep fence-preference, keep the throwing signature and the existing `title`/`leaves` validation (lines 79–93 unchanged):
```ts
export function parseEpicSpec(text: string): EpicSpec {
  const t = (text ?? '').trim();
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  const candidate = fenced && fenced[1].includes('{') ? fenced[1] : t;
  const jsonStr = extractBalancedJsonObject(candidate);
  if (jsonStr == null) throw new Error('planner node emitted no balanced epic-spec JSON object (truncated or absent)');
  let raw: any;
  try { raw = JSON.parse(jsonStr); } catch (e) {
    throw new Error(`planner node emitted no parseable epic-spec JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) throw new Error('planner epic-spec is missing a title');
  // ...leaves filter/map unchanged (lines 80–93)...
}
```

**2c. Add `buildPlannerRepairPrompt`** (exported) — a compact/escaped/prose-free re-ask:
```ts
/** One-shot repair prompt: the first planner emission was unparseable/truncated. Re-ask for the SAME
 *  epic spec as a single minified JSON object, all strings escaped, with NO prose/markdown/fence. */
export function buildPlannerRepairPrompt(project: string, missionId: string, criteria: { id: string; text: string }[]): string {
  return [
    `Your previous reply for project ${project} mission ${missionId} was not parseable JSON (it was`,
    'truncated or wrapped in prose). Re-emit the SAME epic spec as ONE minified JSON object and nothing',
    'else: no markdown, no code fence, no commentary before or after. Escape every quote/newline inside',
    'string values. Shape: {"title":"...","description":"...","leaves":[{"title":"...","description":"...","files":["..."],"dependsOn":["$0"]}]}',
    '',
    'CRITERIA this epic must serve:',
    ...criteria.map((c) => `- (${c.id}) ${c.text}`),
  ].join('\n');
}
```

**2d. Wrap the parse in `planMissionCriterion`** (line 154) with a single repair-retry before failing:
```ts
let spec: EpicSpec;
try {
  spec = parseEpicSpec(res.text);
} catch {
  // Repair-retry ONCE: re-ask compact/escaped/prose-free, then parse again (let a 2nd failure throw).
  const retry = await (deps.invoke ?? invokeNode)({
    prompt: buildPlannerRepairPrompt(project, input.missionId, criteria),
    model, effort,
    allowedTools: ORCHESTRATION_NODE_PROFILE.planner.allowedTools,
    mcpConfig: mcpConfigFor(config.PORT),
    strictMcpConfig: true,
    cwd: project, project,
    permissionMode: 'bypassPermissions',
    transcriptLabel: 'planner',
  });
  if (!retry.ok || !retry.text?.trim()) {
    throw new Error(`plan_mission_criterion: the planner node failed or returned no text on repair retry${retry.rateLimited ? ' (rate-limited)' : ''}`);
  }
  spec = parseEpicSpec(retry.text);
}
```
(`criteria`, `model`, `effort` are all already in scope from lines 132–137.)

---

## Tests (4 falsifiable)

**`src/services/__tests__/conductor-pass.test.ts`** — import `CONDUCTOR_SERVE_RETRY_CAP` from `../conductor-pass`. Add a `failInvoke` (`async () => { invokeCalls++; return { ok: false, rateLimited: false, text: '' } as any; }`).

- **T1 `bounded-retry`**: enabled + `forgeApprovedActive`; call `runConductorPass` with `failInvoke` repeatedly. Assert the node is spawned exactly `CONDUCTOR_SERVE_RETRY_CAP` times across ticks (`invokeCalls === CONDUCTOR_SERVE_RETRY_CAP`), the last extra tick returns `{ ran:false, reason:'debounced' }`, and `invokeCalls` does NOT keep climbing (no permanent thrash, no permanent wedge before the cap).

**`src/mcp/tools/__tests__/mission-planner.test.ts`** — import `extractBalancedJsonObject, buildPlannerRepairPrompt`.

- **T2 `balanced-extract-null-on-truncation`**: `extractBalancedJsonObject('prefix {"title":"x","leaves":[')` returns `null`; a well-formed `{...}` returns the balanced slice.
- **T3 `brace-in-string`**: `parseEpicSpec('{"title":"fix the } bug","leaves":[{"title":"a"}]}')` yields `title === 'fix the } bug'` (naive lastIndexOf would have mis-sliced).
- **T4 `repair-retry`**: a `deps.invoke` spy returning truncated/prose text on call 1 and valid `\`\`\`json … \`\`\`` on call 2; assert `planMissionCriterion` resolves (epic created), the spy was called exactly twice, and call 2's prompt was the repair prompt.

## Verification
`npx tsc --noEmit` clean; `npm run test:ci -- src/services/__tests__/conductor-pass.test.ts src/mcp/tools/__tests__/mission-planner.test.ts` — conductor-pass + mission-planner suites green (30/30 pre-existing + 4 new).

## Acceptance criteria (positive, citable)
1. `conductor-pass.ts` exports `CONDUCTOR_SERVE_RETRY_CAP = 3`.
2. `conductor-pass.ts` exports `conductorFailCount(lastKey, fp)` parsing the `${fp}|fail:N` suffix.
3. `runConductorPassInner` returns `'debounced'` once `conductorFailCount(...) >= CONDUCTOR_SERVE_RETRY_CAP` (the new gate after line 215).
4. The final `stampConductorRun` call stamps `res.ok ? fp : \`${fp}|fail:${failCount + 1}\`` (replacing the unconditional plain-`fp` stamp at line 236).
5. `mission-planner.ts` exports `extractBalancedJsonObject` returning `null` on unterminated input.
6. `parseEpicSpec` obtains its JSON via `extractBalancedJsonObject` (replacing the `indexOf`/`lastIndexOf` slice at lines 71–73).
7. `mission-planner.ts` exports `buildPlannerRepairPrompt`.
8. `planMissionCriterion` invokes the planner a second time via `buildPlannerRepairPrompt` when the first `parseEpicSpec` throws.
9. Named tests T1–T4 present and green.

```json
{ "schemaVersion": 2, "estimatedFiles": 4, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "src/services/conductor-pass.ts",
    "src/mcp/tools/mission-planner.ts",
    "src/services/__tests__/conductor-pass.test.ts",
    "src/mcp/tools/__tests__/mission-planner.test.ts"
  ],
  "tasks": [
    { "id": "bug-a-bounded-retry", "files": ["src/services/conductor-pass.ts"], "description": "Add CONDUCTOR_SERVE_RETRY_CAP + conductorFailCount; stamp plain fp on success, ${fp}|fail:N on failure; cap-debounce gate" },
    { "id": "bug-b-balanced-extract", "files": ["src/mcp/tools/mission-planner.ts"], "description": "Add extractBalancedJsonObject (null on truncation); rewrite parseEpicSpec to use it" },
    { "id": "bug-b-repair-retry", "files": ["src/mcp/tools/mission-planner.ts"], "description": "Add buildPlannerRepairPrompt; retry planner once on unparseable first emission in planMissionCriterion" },
    { "id": "tests", "files": ["src/services/__tests__/conductor-pass.test.ts", "src/mcp/tools/__tests__/mission-planner.test.ts"], "description": "4 tests: bounded-retry, balanced-extract-null, brace-in-string, repair-retry" }
  ],
  "leafKind": "fix",
  "requirements": [
    { "kind": "symbol-present", "file": "src/services/conductor-pass.ts", "symbol": "CONDUCTOR_SERVE_RETRY_CAP", "description": "bounded retry cap (3) replacing permanent debounce wedge" },
    { "kind": "symbol-present", "file": "src/services/conductor-pass.ts", "symbol": "conductorFailCount", "description": "parses ${fp}|fail:N counter to bound retries per fingerprint" },
    { "kind": "symbol-present", "file": "src/mcp/tools/mission-planner.ts", "symbol": "extractBalancedJsonObject", "description": "string/escape-aware brace scan; null on truncation" },
    { "kind": "symbol-present", "file": "src/mcp/tools/mission-planner.ts", "symbol": "buildPlannerRepairPrompt", "description": "compact/escaped/prose-free repair re-ask for the planner" },
    { "kind": "named-test", "testFile": "src/services/__tests__/conductor-pass.test.ts", "testName": "bounded-retry: a failing serve retries up to CONDUCTOR_SERVE_RETRY_CAP then stops", "mechanical": true },
    { "kind": "named-test", "testFile": "src/mcp/tools/__tests__/mission-planner.test.ts", "testName": "extractBalancedJsonObject returns null on a truncated object", "mechanical": true },
    { "kind": "named-test", "testFile": "src/mcp/tools/__tests__/mission-planner.test.ts", "testName": "parseEpicSpec parses a } inside a string value", "mechanical": true },
    { "kind": "named-test", "testFile": "src/mcp/tools/__tests__/mission-planner.test.ts", "testName": "planMissionCriterion retries the planner once with the repair prompt then succeeds", "mechanical": true }
  ],
  "outOfScope": [
    "No mission schema/migration change — the fail counter rides inside the existing lastConductorKey TEXT column",
    "No new ConductorPassResult reason value — the cap path reuses 'debounced'",
    "No change to the serve-cap escalation (CRITERION_SERVE_CAP) path"
  ] }
```