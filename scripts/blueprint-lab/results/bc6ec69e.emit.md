I have everything I need. Here is the implementation blueprint.

---

# Blueprint — `planner` node + `plan_mission_criterion` (Phase 3: conductor delegates planning)

## The seam
Today the conductor node does BOTH jobs: it decides *which* criteria to serve AND it hand-decomposes each into `create_epic`/`add_leaves` inline (`buildConductorPrompt` step 2, `conductor-pass.ts:64-71`). This bundles conducting (which gaps to serve) with planning (how to decompose one gap into a buildable work-graph). Phase 3 splits them: a specialist **`planner` NODE** owns epic decomposition, exactly mirroring the **`forge` node** pattern in `mission-forge.ts` — *node emits a spec, deterministic code instantiates*. The conductor then **delegates** by calling `plan_mission_criterion` instead of decomposing inline.

Two levels of planning stay cleanly layered: **epic decomposition = planner node** (this leaf); **leaf blueprint = the daemon's blueprint node** (unchanged).

## Reference pattern (what to mirror)
`forgeMissionFromDoc` (`src/mcp/tools/mission-forge.ts:362-401`) is the exact template:
- `FORGE_DEFAULT_MODEL='opus'` / `FORGE_DEFAULT_EFFORT='high'` / `FORGE_ALLOWED_TOOLS='Read Grep Glob Bash'` (`mission-forge.ts:251-253`).
- Model/effort resolution: `resolveNodeProvider` + `resolveNodeModel(project,'forge',…)` + `listNodeProfileOverrides(project)['forge']?.effort` (`mission-forge.ts:373-375`) — kind is a free-form string (`resolveNodeModel` at `node-provider.ts:137`, `listNodeProfileOverrides` keyed by arbitrary kind), so `'planner'` needs no enum registration.
- `buildForgePrompt` / `parseForgeSpec` (`mission-forge.ts:259-320`) — read-only node prompt + tolerant fenced/bare JSON extraction that throws on an unparseable/incomplete spec.
- `ForgeFromDocDeps { readDoc?, invoke? }` (`mission-forge.ts:332-337`) — injectable seams for tests.

Instantiation primitives (both from `src/mcp/workgraph-tools.ts`):
- `createEpicWithLandLeaf(project, session, { title, home, homeProvided, description, servesCriterionIds, tier })` (`:41`). Passing `home:missionId, homeProvided:true` homes the epic under the mission (`:67-81`); `servesCriterionIds` links it to the criteria it serves (this is what flips those criteria from `discover`→`building` via `listCriteriaWithActions`).
- `addLeavesToEpic(project, session, epicId, leaves)` (`:106`). Positional `dependsOn:['$0','$1',…]` refs resolve to earlier intra-batch siblings (`:121-131`); each leaf carries `status:'ready'` to approve-at-creation (**PROMOTED-TO-READY** — `session-todos.ts:487`/`workgraph-tools.ts:202` "status:'ready' approves at creation, skips the planned→ready promotion").

## 1. New file — `src/mcp/tools/mission-planner.ts`

Header comment: the machinery half of "delegated planning" — a specialist `planner` node decomposes one-or-more acceptance criteria into ONE right-sized epic + dep-ordered leaves grounded against real code; deterministic code instantiates it PROMOTED-TO-READY, mission-homed, serving those criteria. Mirrors the forge pattern.

Imports: `createEpicWithLandLeaf`, `addLeavesToEpic`, `type LeafInput` from `../workgraph-tools.js`; `getMission`, `listCriteria`, `type MissionCriterion` from `../../services/mission-store.js`; `getTodo`, `deriveTodoViews` from `../../services/todo-store.js`; `invokeNode`, `mcpConfigFor`, `type NodeSpec`, `type NodeResult` from `../../agent/node-invoker.js`; `resolveNodeModel`, `resolveNodeProvider` from `../../services/node-provider.js`; `listNodeProfileOverrides` from `../../services/orchestrator-config.js`; `config` from `../../config.js`; `type EffortLevel` from `../../agent/contracts.js`.

```
const PLANNER_DEFAULT_MODEL = 'opus';
const PLANNER_DEFAULT_EFFORT: EffortLevel = 'high';
// Grounding is READ-ONLY (Read/Grep/Glob/Bash) — the planner emits a spec, it never builds.
const PLANNER_ALLOWED_TOOLS = 'Read Grep Glob Bash';
```

**Types:**
```
export interface PlannerLeafSpec {
  title: string; description?: string; type?: string;
  files?: string[]; tier?: LeafInput['tier']; dependsOn?: string[]; // '$0'..'$N' positional
}
export interface PlannerSpec {
  epicTitle: string; epicDescription?: string; leaves: PlannerLeafSpec[];
}
export interface PlanMissionCriterionInput {
  session: string; missionId: string; criterionIds: string[];
  model?: string; effort?: EffortLevel;
}
export interface PlanMissionCriterionDeps {
  invoke?: (spec: NodeSpec) => Promise<NodeResult>;
  // Default: validate criterionIds against listCriteria(project, missionId); throw on unknown.
  resolveCriteria?: (project: string, missionId: string, criterionIds: string[]) => MissionCriterion[];
}
export interface PlanMissionCriterionResult {
  epic: ReturnType<typeof deriveTodoViews>[number];
  missionId: string;
  servedCriteria: MissionCriterion[];
  createdLeafIds: string[];
  spec: PlannerSpec;
  modelUsed: string; effortUsed: EffortLevel;
}
```

**`buildPlannerPrompt(missionTitle, missionDescription, criteria: MissionCriterion[]): string`** — self-contained (references nothing in `skills/`), mirroring `buildForgePrompt`'s structure. Content:
- "You are the PLANNER node for mission `<title>`. READ-ONLY: use Read/Grep/Glob and Bash for INSPECTION only (ground the plan in the real files/seams). Do NOT edit anything."
- Inline the mission description + the criteria-to-serve (numbered, with their ids).
- Discipline: emit ONE right-sized epic that serves ALL the listed criteria; decompose into buildable leaves each sized for one daemon build node; sequence leaves by dependency using positional `dependsOn:['$0',…]`; ground every leaf's `files` against real paths you inspected; a leaf is a coherent change with a self-checkable outcome, not a whole feature.
- Emit EXACTLY ONE JSON object as the FINAL reply (optionally in a ```json fence), shape:
```
{ "epicTitle": "<bare, no role prefix>", "epicDescription": "<one line>",
  "leaves": [ { "title": "...", "description": "...", "type": "...",
               "files": ["..."], "tier": "full|small|test-pinned",
               "dependsOn": ["$0"] } ] }
```

**`parsePlannerSpec(text: string): PlannerSpec`** — copy `parseForgeSpec`'s fenced/bare extraction verbatim (`mission-forge.ts:294-320`), then validate: `epicTitle` is a non-empty string (else `throw new Error('planner node spec is missing an epicTitle')`); `leaves` is a non-empty array of objects each with a non-empty string `title` (filter, else `throw new Error('planner node spec has no leaves')`). Wrap `JSON.parse` failure as `throw new Error('planner node emitted no parseable epic-spec JSON: …')`. Coerce `dependsOn`/`files` to string arrays defensively.

**`defaultResolveCriteria(project, missionId, criterionIds)`** — read `listCriteria(project, missionId)` into a `Map<id, MissionCriterion>`; for each requested id, if absent `throw new Error('plan_mission_criterion: unknown criterion <id> (not on mission <missionId>)')`; return in requested order.

**`planMissionCriterion(project, input, deps={})`** — the orchestration, ordered so every validation throws BEFORE anything is created:
1. Guard `project && input.session && input.missionId` and `criterionIds` non-empty array → else throw `'plan_mission_criterion: project, session, missionId, and at least one criterionId are required'`.
2. `if (!getMission(project, input.missionId)) throw new Error('plan_mission_criterion: mission not found: ' + missionId)`.
3. `const served = (deps.resolveCriteria ?? defaultResolveCriteria)(project, missionId, criterionIds)` — **unknown criteria throw here, before any node spend or creation.**
4. Resolve model/effort (mirror `mission-forge.ts:373-375` with kind `'planner'`): `provider = resolveNodeProvider(project,'planner',PLANNER_ALLOWED_TOOLS)`; `model = input.model ?? resolveNodeModel(project,'planner',provider,PLANNER_DEFAULT_MODEL)`; `effort = input.effort ?? listNodeProfileOverrides(project)['planner']?.effort ?? PLANNER_DEFAULT_EFFORT`.
5. `const res = await (deps.invoke ?? invokeNode)({ prompt: buildPlannerPrompt(…), model, effort, allowedTools: PLANNER_ALLOWED_TOOLS, strictMcpConfig: true, permissionMode: 'bypassPermissions', cwd: project, project, transcriptLabel: 'planner' })` — like `forge` (no `mcpConfig`; planner uses only built-in tools, `strictMcpConfig:true`).
6. `if (!res.ok || !res.text?.trim()) throw new Error('plan_mission_criterion: the planner node failed or returned no text' + (res.rateLimited ? ' (rate-limited)' : ''))`.
7. `const spec = parsePlannerSpec(res.text)` — **unparseable spec throws here, before creating the epic.**
8. `const { epic } = await createEpicWithLandLeaf(project, session, { title: spec.epicTitle, description: spec.epicDescription, home: missionId, homeProvided: true, servesCriterionIds: criterionIds })`.
9. `const { createdIds } = await addLeavesToEpic(project, session, epic.id, spec.leaves.map(l => ({ title: l.title, description: l.description, type: l.type, files: l.files, tier: l.tier, dependsOn: l.dependsOn, status: 'ready' as const })))` — **PROMOTED-TO-READY**.
10. Return `{ epic: deriveTodoViews(project,[epic])[0], missionId, servedCriteria: served, createdLeafIds: createdIds, spec, modelUsed: model, effortUsed: effort }`.

## 2. `src/mcp/mission-tools.ts` — register the MCP tool

- Import: extend the existing `mission-forge.js` import line with a new import from `'./tools/mission-planner.js'` (`planMissionCriterion`).
- Add to `MISSION_TOOL_DEFS` (after `set_mission_criterion`, `mission-tools.ts:36`) a `plan_mission_criterion` def: describe it as "DELEGATED PLANNING: a specialist `planner` node (model/effort via node_profile_override kind 'planner', default opus/high, per-call overridable) decomposes one-or-more mission acceptance criteria into ONE right-sized epic + dep-ordered leaves, grounded against real code, and instantiates it mission-homed + PROMOTED-TO-READY serving those criteria. The conductor calls this instead of hand-rolling create_epic/add_leaves. Node emits a spec; code instantiates." Input schema: `project`, `session`, `missionId`, `criterionIds` (array of strings), `model`, `effort` (enum `['low','medium','high','xhigh','max']`); required `['project','session','missionId','criterionIds']`.
- Add a `case 'plan_mission_criterion':` in `handleMissionTool` (mirror the `forge_mission_from_doc` case, `mission-tools.ts:84-91`): destructure args, guard required, `const result = await planMissionCriterion(project, { session, missionId, criterionIds, model, effort })`, broadcast `session_todos_updated`, `return JSON.stringify(result, null, 2)`.

This is auto-covered by `src/mcp/__tests__/tool-dispatch-coverage.test.ts:61` ("every MISSION_TOOL_DEFS name is wired in handleMissionTool") — the new def MUST have a matching handler case or that test fails.

## 3. `src/services/conductor-pass.ts` — conductor delegates

- **`CONDUCTOR_ALLOWED_TOOLS` (`:33-40`):** add `'mcp__mermaid__plan_mission_criterion'`. (It already has `create_epic`/`add_leaves`; keep them so the conductor can still file directly when appropriate, but the prompt steers to the planner.)
- **`buildConductorPrompt` step 2 (`:64-71`):** rewrite the "serve it" instruction to DELEGATE: for a group of related `discover` criteria, after GROUNDing the gap, call `mcp__mermaid__plan_mission_criterion` with `{ missionId, criterionIds: [the ids to group into one epic] }` — the planner node decomposes the criteria into a mission-homed, ready epic+leaves; the conductor does NOT run `create_epic`/`add_leaves` inline for discovery planning. Keep the "one right-sized epic MAY serve several related criteria" and "the daemon does the build/land, not you" guidance.

## 4. Tests

**`src/mcp/tools/__tests__/mission-planner.test.ts`** (new — mirror `mission-forge.test.ts`'s temp-dir + stable `MERMAID_SUPERVISOR_DIR` setup, `mission-forge.test.ts:9-28`). Create a real mission via `forgeMission` (or `create_mission` primitives) to get a `missionId` + real criterion ids from `listCriteria`. A `mockDeps` returning an injected `invoke` (`{ ok:true, text:'```json'+JSON.stringify(spec)+'```' }`) and using the default `resolveCriteria`:
1. `test('instantiates a mission-homed epic serving the criteria with ready, dep-ordered leaves')` — spec with 2 leaves, `leaves[1].dependsOn:['$0']`; assert the returned epic's `missionId === missionId`, its `servesCriterionIds` include the served ids, both leaves exist with `derivedStatus === 'ready'`, and leaf-2's resolved `dependsOn` contains leaf-1's id (via `getTodo`).
2. `test('one epic serves several criteria')` — pass 2 `criterionIds`; assert a single created epic whose `servesCriterionIds` includes both.
3. `test('an unparseable planner spec throws before any epic is created')` — `invoke` returns junk text; `expect(...).rejects.toThrow(/no parseable epic-spec JSON/i)`; assert no epic was created under the mission (`getMissionRollup`/`listTodos` shows zero epic children).
4. `test('an unknown criterion id throws before invoking the node')` — pass a bogus id; `rejects.toThrow(/unknown criterion/i)`; assert the injected `invoke` was never called (spy flag) and no epic created.
5. `test('planner model/effort default to opus/high and are returned')` — assert `result.modelUsed==='opus'` and `result.effortUsed==='high'`.
6. `test('parsePlannerSpec parses fenced + bare JSON and throws on missing epicTitle/leaves')` — unit-level, mirror the `parseForgeSpec` describe block (`mission-forge.test.ts:184-199`).

**`src/services/__tests__/conductor-pass.test.ts`** — extend the existing pure `buildConductorPrompt` describe (`:84`): add `test('the conductor delegates discovery planning to plan_mission_criterion')` asserting `buildConductorPrompt('/proj','m1','T','s')` contains `'plan_mission_criterion'`.

## Full-suite / tsc
`npm run test:ci` → 270/270 (backend runs under two runners — `bun test` for `bun:test`, vitest for vitest; `mission-planner.test.ts` uses `bun:test` like `mission-forge.test.ts`); `tsc` clean.

## Acceptance criteria (positive, citable)
1. `src/mcp/tools/mission-planner.ts` exports `planMissionCriterion` which invokes a `'planner'`-kind node (`resolveNodeModel(project,'planner',…)`, default `opus`/`high`) and, on a parsed spec, calls `createEpicWithLandLeaf` with `home:missionId, homeProvided:true, servesCriterionIds:criterionIds` then `addLeavesToEpic` with each leaf `status:'ready'`.
2. `parsePlannerSpec` in `mission-planner.ts` throws `'planner node emitted no parseable epic-spec JSON'` on unparseable text and on a spec missing `epicTitle` or `leaves`.
3. `planMissionCriterion` validates the mission (`getMission`) and every `criterionId` (via `resolveCriteria`) BEFORE invoking the node or creating anything — unknown criteria throw first.
4. `MISSION_TOOL_DEFS` in `src/mcp/mission-tools.ts` contains a `plan_mission_criterion` def and `handleMissionTool` has a matching `case 'plan_mission_criterion'` delegating to `planMissionCriterion`.
5. `CONDUCTOR_ALLOWED_TOOLS` in `src/services/conductor-pass.ts` includes `mcp__mermaid__plan_mission_criterion`, and `buildConductorPrompt` step 2 instructs the conductor to call `plan_mission_criterion` for discovery planning.
6. `src/mcp/tools/__tests__/mission-planner.test.ts` proves: a mission-homed epic serving the criteria with ready dep-ordered leaves; one epic serving several criteria; unparseable spec and unknown criteria each throwing before creation.

```json
{ "schemaVersion": 2, "estimatedFiles": 5, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/mcp/tools/mission-planner.ts", "src/mcp/tools/__tests__/mission-planner.test.ts"],
  "filesToEdit": ["src/mcp/mission-tools.ts", "src/services/conductor-pass.ts", "src/services/__tests__/conductor-pass.test.ts"],
  "tasks": [
    { "id": "planner-node", "files": ["src/mcp/tools/mission-planner.ts"], "description": "planner node: buildPlannerPrompt + parsePlannerSpec + planMissionCriterion (createEpicWithLandLeaf + addLeavesToEpic ready, injectable invoke/resolveCriteria)" },
    { "id": "mcp-register", "files": ["src/mcp/mission-tools.ts"], "description": "register plan_mission_criterion in MISSION_TOOL_DEFS + handleMissionTool case" },
    { "id": "conductor-delegate", "files": ["src/services/conductor-pass.ts"], "description": "add plan_mission_criterion to CONDUCTOR_ALLOWED_TOOLS + delegate discovery planning in buildConductorPrompt" },
    { "id": "tests", "files": ["src/mcp/tools/__tests__/mission-planner.test.ts", "src/services/__tests__/conductor-pass.test.ts"], "description": "6 planner tests + conductor-prompt delegation assertion" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/mcp/tools/mission-planner.ts", "symbol": "planMissionCriterion", "description": "the machinery: planner node → createEpicWithLandLeaf + addLeavesToEpic(ready)" },
    { "kind": "symbol-present", "file": "src/mcp/tools/mission-planner.ts", "symbol": "buildPlannerPrompt", "description": "self-contained planner node prompt" },
    { "kind": "symbol-present", "file": "src/mcp/tools/mission-planner.ts", "symbol": "parsePlannerSpec", "description": "tolerant epic-spec JSON extraction that throws on unparseable/incomplete spec" },
    { "kind": "named-test", "testFile": "src/mcp/tools/__tests__/mission-planner.test.ts", "testName": "instantiates a mission-homed epic serving the criteria with ready, dep-ordered leaves", "mechanical": true },
    { "kind": "named-test", "testFile": "src/mcp/tools/__tests__/mission-planner.test.ts", "testName": "one epic serves several criteria", "mechanical": true },
    { "kind": "named-test", "testFile": "src/mcp/tools/__tests__/mission-planner.test.ts", "testName": "an unparseable planner spec throws before any epic is created", "mechanical": true },
    { "kind": "named-test", "testFile": "src/mcp/tools/__tests__/mission-planner.test.ts", "testName": "an unknown criterion id throws before invoking the node", "mechanical": true },
    { "kind": "named-test", "testFile": "src/mcp/tools/__tests__/mission-planner.test.ts", "testName": "planner model/effort default to opus/high and are returned", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/conductor-pass.test.ts", "testName": "the conductor delegates discovery planning to plan_mission_criterion", "mechanical": true },
    { "kind": "threshold", "source": "grep-count", "metric": "plan_mission_criterion in conductor-pass.ts (allowlist + prompt)", "comparison": "gte", "value": 2, "mechanical": true }
  ],
  "outOfScope": ["leaf-level blueprinting (stays the daemon's blueprint node)", "adding 'planner' to any node-kind enum (kind is a free-form node_profile_override key)", "changing createEpicWithLandLeaf/addLeavesToEpic signatures", "removing the conductor's direct create_epic/add_leaves tools"] }
```