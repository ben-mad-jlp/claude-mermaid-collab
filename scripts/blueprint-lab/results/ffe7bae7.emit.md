<!-- blueprint-lab-emit model=sonnet effort=medium -->
# Blueprint: autonomous conductor node v1 (Phase 2)

## Context grounded in the codebase

This is Phase 2 of the roadmap in `docs/autonomous-conductor.md:55-61`. Phase 1 (already shipped, commits `a4d8a493`/`9e506ad4`) built `forgeMissionFromDoc` in `src/mcp/tools/mission-forge.ts:362-401` — a server-side `forge` NODE spawned via `invokeNode` with its own default model/effort (`FORGE_DEFAULT_MODEL`/`FORGE_DEFAULT_EFFORT`, `mission-forge.ts:251-252`), resolved through `resolveNodeModel`/`resolveNodeProvider` (`src/services/node-provider.ts:59,137`) and `listNodeProfileOverrides` (`src/services/orchestrator-config.ts:313`). Phase 2 follows the **same node-invocation shape**, but instead of emitting a mission spec it drives an already-approved mission's work-graph gaps and lands.

Key existing primitives this leans on:
- `listMissions`/`getMission`/`getMissionRollup`/`listCriteriaWithActions` in `src/services/mission-store.ts:733-837` — the derived per-criterion `action` (`met|building|verify|discover`, `mission-store.ts:625-638`) and `MissionRollup.gaps`/`awaitingVerify` (`mission-store.ts:111-128`).
- The mission-loop's nudge fingerprint pattern (`src/services/mission-loop.ts:47-52`, `93-151`) — status + met/total + gaps + awaitingVerify, debounced against a stored key. `mission-store.ts` already has this exact pattern for nudges (`lastNudgeAt`/`lastNudgeKey`, `mission-store.ts:52-55, 197-198, 242-246`); the conductor needs its own sibling column so a conductor spawn doesn't reuse/collide with the nudge debounce.
- The orchestrator tick's per-project, per-watched-project pass wiring in `src/services/orchestrator-live.ts:233-419` (`TickDeps`, `withPassTimeout`, the `missionLoop` pass at `orchestrator-live.ts:339-346` as the closest sibling — same "runs for watched projects, best-effort, bounded" shape).
- The `watched_project` boolean-toggle pattern: `gateShadowMode` get/set (`src/services/supervisor-store.ts:493-505`) is the template — default OFF, UPDATE-only setter (no-op if the project isn't watched), REST GET+POST mirrored 1:1 (`src/routes/supervisor-routes.ts:812-848` — the `watchdog-threshold` GET/POST pair, and `878-904` — the `injection-flags` GET/POST pair, are both good templates).
- MCP tool names the node will call: `mcp__mermaid__create_epic`, `mcp__mermaid__add_leaves` (`src/mcp/workgraph-tools.ts:182-230`), `mcp__mermaid__get_mission` (`src/mcp/mission-tools.ts:34`), `mcp__mermaid__set_mission_criterion` (`mission-tools.ts:36`), `mcp__mermaid__land_epic` with `actor:'conductor'` + `session` (`src/mcp/setup.ts:1012` — already supports and ownership-gates the conductor actor kind; see `src/routes/supervisor-routes.ts:59-72` for the actor-kind resolution this reuses). The `mcp__<server>__<tool>` naming and `mcpConfigFor(config.PORT)` wiring is confirmed at `src/agent/node-invoker.ts:59-73` and used exactly this way for MCP-bearing node kinds in `src/services/leaf-executor.ts:2006-2010, 2140-2147`.
- The interactive `/conductor` skill (`skills/conductor/SKILL.md`) is the **judgment discipline** to distill into the node prompt — EXCEPT its "you never land" rule, which is the human-session variant. The autonomous node's contract is the opposite per the locked decision at `docs/autonomous-conductor.md:13-15`: it **does** land, gated on converged + VERIFY-green.

## Change shape

### 1. `src/services/mission-store.ts` — debounce column

- Add `lastConductorKey: string | null` to `MissionRow` (after `lastNudgeKey`, near `mission-store.ts:55`).
- `SCHEMA`/migration: add `addColumnIfMissing(db, 'mission', 'lastConductorKey', 'lastConductorKey TEXT')` beside the existing `lastNudgeAt`/`lastNudgeKey` migrations (`mission-store.ts:197-198`).
- `rowToMission` (`mission-store.ts:226-239`): map `lastConductorKey: (row.lastConductorKey as string | null) ?? null`.
- New exported function, sibling to `stampMissionNudge` (`mission-store.ts:242-246`):
  ```ts
  export function stampConductorRun(project: string, todoId: string, key: string): void {
    openDb(project)
      .prepare('UPDATE mission SET lastConductorKey = ?, updatedAt = ? WHERE todoId = ?')
      .run(key, nowMs(), todoId);
  }
  ```

### 2. `src/services/conductor-pass.ts` (new file) — the pass + the node

Modeled directly on `forgeMissionFromDoc`/`buildForgePrompt` (`src/mcp/tools/mission-forge.ts:246-401`).

```ts
import { config } from '../config.js';
import { invokeNode, mcpConfigFor, type NodeSpec, type NodeResult } from '../agent/node-invoker.js';
import { resolveNodeModel, resolveNodeProvider } from './node-provider.js';
import { listNodeProfileOverrides } from './orchestrator-config.js';
import { listMissions, isMissionTerminal, stampConductorRun, type MissionSummary } from './mission-store.js';
import type { EffortLevel } from '../agent/contracts.js';

export const CONDUCTOR_DEFAULT_MODEL = 'opus';
export const CONDUCTOR_DEFAULT_EFFORT: EffortLevel = 'high';
export const CONDUCTOR_ALLOWED_TOOLS =
  'Read Grep Glob Bash ' +
  'mcp__mermaid__get_mission mcp__mermaid__create_epic mcp__mermaid__add_leaves ' +
  'mcp__mermaid__set_mission_criterion mcp__mermaid__land_epic ' +
  'mcp__mermaid__epic_land_readiness mcp__mermaid__verify_epic mcp__mermaid__get_todo';

/** Debounce fingerprint — same shape as mission-loop's nudge fingerprint (mission-loop.ts:50-52),
 *  but keyed separately (lastConductorKey) so nudge and conductor debounce independently. */
export function conductorFingerprint(m: MissionSummary): string {
  const { status, capability } = m.rollup;
  return `${status}:${capability.met}/${capability.total}:g${m.rollup.gaps}:v${m.rollup.awaitingVerify}`;
}

/** Pick the ONE mission this pass should drive: approved (awaitingApprovalSince null),
 *  active, non-terminal. Mirrors sessionHasActiveMission's terminal/approval filtering
 *  (mission-store.ts:373-378) but project-wide (no session scope — the conductor drives
 *  whichever mission is active for its owning session). */
export function selectConductorMission(missions: MissionSummary[]): MissionSummary | null {
  return missions.find(
    (m) => m.mission.active && m.mission.awaitingApprovalSince == null && !isMissionTerminal(m.mission),
  ) ?? null;
}

export function buildConductorPrompt(mission: MissionSummary): string { /* distilled /conductor
  discipline: per-criterion action table, serve every discover gap (create_epic+add_leaves,
  status:'ready'), run VERIFY on every 'verify' gap via set_mission_criterion (independent of
  the leaf that built it — maker≠checker already holds since the daemon's implement/review
  nodes wrote the code, not this node), and — UNLIKE the interactive skill — land a
  converged+VERIFY-green epic via land_epic{actor:'conductor', session}. Never hand-edit source
  (no Edit/Write tool granted). Include mission.node.id, title, description, handoffDocId. */ }

export interface ConductorPassDeps {
  listMissions?: (project: string) => MissionSummary[];
  invoke?: (spec: NodeSpec) => Promise<NodeResult>;
  isEnabled?: (project: string) => boolean; // getConductorEnabled
  stamp?: (project: string, todoId: string, key: string) => void;
}

export interface ConductorPassResult {
  ran: boolean;
  missionId?: string;
  reason: string; // 'disabled' | 'no-mission' | 'debounced' | 'ran'
}

export async function runConductorPass(project: string, deps: ConductorPassDeps = {}): Promise<ConductorPassResult> {
  const isEnabled = deps.isEnabled ?? getConductorEnabled;
  if (!isEnabled(project)) return { ran: false, reason: 'disabled' };

  const list = deps.listMissions ?? ((p: string) => listMissions(p));
  const mission = selectConductorMission(list(project));
  if (!mission) return { ran: false, reason: 'no-mission' };

  const key = conductorFingerprint(mission);
  if (mission.mission.lastConductorKey === key) return { ran: false, missionId: mission.node.id, reason: 'debounced' };

  const provider = resolveNodeProvider(project, 'conductor', CONDUCTOR_ALLOWED_TOOLS); // forced 'claude' (mcp__-bearing)
  const model = resolveNodeModel(project, 'conductor', provider, CONDUCTOR_DEFAULT_MODEL);
  const effort = listNodeProfileOverrides(project)['conductor']?.effort ?? CONDUCTOR_DEFAULT_EFFORT;
  const invoke = deps.invoke ?? invokeNode;

  await invoke({
    prompt: buildConductorPrompt(mission),
    model, effort,
    allowedTools: CONDUCTOR_ALLOWED_TOOLS,
    mcpConfig: mcpConfigFor(config.PORT),
    permissionMode: 'bypassPermissions',
    cwd: project, project,
    transcriptLabel: 'conductor',
  });

  (deps.stamp ?? stampConductorRun)(project, mission.node.id, key);
  return { ran: true, missionId: mission.node.id, reason: 'ran' };
}
```

### 3. `src/services/supervisor-store.ts` — per-project toggle (default OFF)

Add column + get/set, sibling to `gateShadowMode` (`supervisor-store.ts:203-204, 325, 493-505`):
- DDL/migration: `addColumnIfMissing(db, 'watched_project', 'conductorEnabled', 'conductorEnabled INTEGER')`.
- ```ts
  export function getConductorEnabled(project: string): boolean {
    const d = openDb();
    const row = d.query('SELECT conductorEnabled FROM watched_project WHERE project = ?')
      .get(project) as { conductorEnabled: number | null } | undefined;
    return !!row?.conductorEnabled;
  }
  export function setConductorEnabled(project: string, on: boolean): void {
    const d = openDb();
    d.prepare('UPDATE watched_project SET conductorEnabled = ? WHERE project = ?')
      .run(on ? 1 : 0, project);
  }
  ```

### 4. `src/routes/supervisor-routes.ts` — REST GET/POST

Mirror the `watchdog-threshold` pair (`supervisor-routes.ts:812-848`):
```ts
if (url.pathname === '/api/supervisor/conductor' && req.method === 'GET') {
  const project = url.searchParams.get('project');
  if (!project) return jsonError('project is required', 400);
  return Response.json({ project, enabled: getConductorEnabled(project) });
}
if (url.pathname === '/api/supervisor/conductor' && req.method === 'POST') {
  try {
    const { project, enabled } = (await req.json()) as { project?: string; enabled?: boolean };
    if (!project) return jsonError('project is required', 400);
    if (typeof enabled !== 'boolean') return jsonError('enabled must be a boolean', 400);
    setConductorEnabled(project, enabled);
    return Response.json({ ok: true, project, enabled: getConductorEnabled(project) });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
  }
}
```
Import `getConductorEnabled, setConductorEnabled` from `../services/supervisor-store.ts` in the existing import block (`supervisor-routes.ts:20-31`).

### 5. `src/services/orchestrator-live.ts` — tick wiring

- New timeout constant beside the others (`orchestrator-live.ts:74-77`): `const CONDUCTOR_PASS_TIMEOUT_MS = 15 * 60_000;` (bounds one node invocation; node's own default 600s cap plus MCP round-trips).
- `TickDeps` (`orchestrator-live.ts:196-231`): add `conductor?: (project: string) => Promise<unknown>;` with a doc comment analogous to `missionLoop`'s (`orchestrator-live.ts:217-221`).
- `runOrchestratorTick` (`orchestrator-live.ts:234-248`): `const conductor = deps.conductor ?? runConductorPass;`.
- New pass block placed immediately AFTER the existing mission-loop block (`orchestrator-live.ts:339-346`), same `watched.has(project)` gate — the toggle itself lives inside `runConductorPass` (self-gating, like `getConductorEnabled`), matching the description's "self-gates on the per-project `conductor` toggle":
  ```ts
  if (watched.has(project)) {
    try {
      currentPhase = `${project}:conductor`;
      await withPassTimeout(conductor(project), CONDUCTOR_PASS_TIMEOUT_MS, `${project}:conductor`);
    } catch (err) {
      console.warn(`[orchestrator] conductor pass failed for ${project}:`, err);
    }
  }
  ```
- Import: `import { runConductorPass } from './conductor-pass.js';` beside the `runMissionLoopPass` import (`orchestrator-live.ts:28`).

### Tests (7, per the leaf title)
1. disabled (`getConductorEnabled` false) → no-op, no node spawn.
2. no approved+active+non-terminal mission → no-op.
3. a `discover` gap present → node invoked with a prompt naming the mission + gap.
4. debounced: same fingerprint on a second call → no second invoke.
5. an `unapproved` mission is never selected/driven (`selectConductorMission` skips it).
6. `conductorFingerprint` changes when gaps/awaitingVerify/status change → re-invokes after being previously stamped.
7. `buildConductorPrompt` shape — contains mission id/title and the land-authority instruction.

Plus the tick-wiring assertion (fits inside test 3 or as an 8th, still within the leaf's stated scope): `orchestrator-live.test.ts` — a watched project with `conductor` deps spy gets called once per tick, guarded by `withPassTimeout`.

```json
{ "schemaVersion": 2, "estimatedFiles": 5, "estimatedTasks": 6,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/services/conductor-pass.ts", "src/services/__tests__/conductor-pass.test.ts"],
  "filesToEdit": [
    "src/services/mission-store.ts",
    "src/services/supervisor-store.ts",
    "src/routes/supervisor-routes.ts",
    "src/services/orchestrator-live.ts"
  ],
  "tasks": [
    { "id": "mission-store-debounce-column", "files": ["src/services/mission-store.ts"], "description": "Add lastConductorKey column + stampConductorRun" },
    { "id": "conductor-pass-module", "files": ["src/services/conductor-pass.ts"], "description": "runConductorPass + buildConductorPrompt + fingerprint/select helpers, spawns the conductor node via invokeNode" },
    { "id": "conductor-toggle-store", "files": ["src/services/supervisor-store.ts"], "description": "conductorEnabled watched_project column + getConductorEnabled/setConductorEnabled" },
    { "id": "conductor-rest-route", "files": ["src/routes/supervisor-routes.ts"], "description": "GET/POST /api/supervisor/conductor mirroring the watchdog-threshold pair" },
    { "id": "orchestrator-tick-wiring", "files": ["src/services/orchestrator-live.ts"], "description": "TickDeps.conductor + CONDUCTOR_PASS_TIMEOUT_MS + tick block after mission-loop" },
    { "id": "conductor-pass-tests", "files": ["src/services/__tests__/conductor-pass.test.ts"], "description": "7 tests: disabled/no-mission/discover-spawn/debounce/unapproved-skip/fingerprint-change/prompt-shape" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/services/conductor-pass.ts", "symbol": "runConductorPass", "description": "the per-tick conductor pass entry point" },
    { "kind": "symbol-present", "file": "src/services/mission-store.ts", "symbol": "stampConductorRun", "description": "the debounce stamp, sibling to stampMissionNudge" },
    { "kind": "symbol-present", "file": "src/services/supervisor-store.ts", "symbol": "getConductorEnabled", "description": "per-project toggle, default OFF" },
    { "kind": "symbol-present", "file": "src/services/supervisor-store.ts", "symbol": "setConductorEnabled", "description": "UPDATE-only setter for the toggle" },
    { "kind": "symbol-present", "file": "src/services/orchestrator-live.ts", "symbol": "CONDUCTOR_PASS_TIMEOUT_MS", "description": "bounded backstop timeout for the new tick pass" },
    { "kind": "named-test", "testFile": "src/services/__tests__/conductor-pass.test.ts", "testName": "disabled no-op", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/conductor-pass.test.ts", "testName": "spawns on a discover gap", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/conductor-pass.test.ts", "testName": "debounced by fingerprint", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/conductor-pass.test.ts", "testName": "unapproved mission never driven", "mechanical": true },
    { "kind": "threshold", "source": "gate-output", "metric": "backend-suite-pass-rate", "comparison": "eq", "value": 1, "mechanical": true }
  ],
  "outOfScope": ["Phase 3 planner-node triggering", "Phase 4 UI node model-settings matrix surfacing 'conductor' kind", "Phase 5 UI conductor status/log viewer"] }
```