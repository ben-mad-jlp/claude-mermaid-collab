# Blueprint: [grok-full retest] Add GET /api/orchestrator/node-routing (per-kind provider table)

## Goal
Add a read-only diagnostic endpoint under the orchestrator namespace that exposes the resolved provider ('claude' | 'grok-build') for each of the 10 standard build node kinds. This is a clean retest exercising grok as full builder (blueprint + implement + review) after the streaming-json parse fix. The change is multi-file, additive, and low-risk.

## Non-Goals
- No changes to provider resolution logic itself (MCP-forced claude, per-kind env/config, project default remain exactly as-is in resolveNodeProvider).
- No mutations to config or side effects.
- Do not alter leaf-executor runtime dispatch (leaf-executor.ts continues to call resolveNodeProvider(kind, allowedTools) per-node).
- The existing `/api/leaf-executor/node-routing` (0-arg) continues to function.

## Files

1. src/services/node-provider.ts
2. src/routes/orchestrator-routes.ts
3. src/services/__tests__/node-provider.test.ts
4. .collab/leaf-blueprints/928b78d0-c172-4fb8-8213-db509426f444.md (this blueprint — created by blueprint node)

## Detailed Changes

### 1. src/services/node-provider.ts

**Additive changes only. Existing exports (resolveNodeProvider, resolveAllNodeProviders, anyGrokNodeConfigured, grokLedgerModel, FLOOR_NODE_ALLOWLISTS, nodeRoutingTable) remain.**

- Keep the existing `FLOOR_NODE_ALLOWLISTS` and its 4 entries exactly (used by current 0-arg nodeRoutingTable and by leaf-executor/node-routing endpoint in api.ts:3258).
- Evolve the exported `nodeRoutingTable` to accept an optional project parameter while preserving 0-arg call sites:
  ```ts
  export function nodeRoutingTable(project?: string): Record<string, NodeProvider>
  ```
  - The `project` parameter is accepted for route parity and future scoping but is **unused** for resolution (provider config is global via getConfig + env `MERMAID_NODE_PROVIDER*`).
- Inside `nodeRoutingTable` (or at module scope as a small unexported/local const named `FLOOR_ALLOWLISTS` per task), define the 10-kind allowlist map exactly as specified:

  ```ts
  // local to node-provider.ts (do not export unless needed by tests; task says "local")
  const FLOOR_ALLOWLISTS: Record<string, string> = {
    blueprint:  'Read Write Grep Glob Bash',
    implement:  'Read Edit Grep Glob Bash',
    review:     'Read Grep Glob Bash',
    research:   'Read Grep Glob Bash',
    wimplement: 'Read Grep Glob Bash',
    verify:     'Read Grep Glob Bash',
    fix:        'Read Grep Glob Bash',
    driveplan:  'Read Grep Glob Bash',
    report:     'Read Grep Glob mcp__mermaid__add_session_todo',
    driveexec:  'Read Write Bash mcp__mermaid__decide_requirement',
  };
  ```

- Implementation body (delegates, no new logic):
  ```ts
  export function nodeRoutingTable(project?: string): Record<string, NodeProvider> {
    return resolveAllNodeProviders(Object.keys(FLOOR_ALLOWLISTS), FLOOR_ALLOWLISTS);
  }
  ```
- Update the JSDoc on `nodeRoutingTable` to mention it is also used by the new `/api/orchestrator/node-routing?project=<abs>` and that it covers the 10 standard build node kinds. Keep the prior comment about the leaf-executor caller.
- `resolveAllNodeProviders` and `resolveNodeProvider` are **not changed** in signature or behavior. The MCP guard `if ((allowedTools ?? '').includes('mcp__')) return 'claude';` (node-provider.ts:43) is what forces report/driveexec to claude.

**Citations (existing symbols/lines before edit):**
- resolveNodeProvider: src/services/node-provider.ts:42
- resolveAllNodeProviders: src/services/node-provider.ts:86
- FLOOR_NODE_ALLOWLISTS: src/services/node-provider.ts:99
- Current nodeRoutingTable: src/services/node-provider.ts:111
- MCP guard: src/services/node-provider.ts:43
- cfg + asProvider helpers: src/services/node-provider.ts:25-51

### 2. src/routes/orchestrator-routes.ts

**Pure addition of one GET handler inside `handleOrchestratorRoutes`.**

- Add a top-of-file import (matching style of other .ts imports in this file):
  ```ts
  import { nodeRoutingTable } from '../services/node-provider.ts';
  ```
  (Place near the existing imports from '../services/leaf-executor.ts' etc.)

- Insert a new handler block before the final `return null;` (around line 210). Exact shape mirroring nearby GET routes that require `?project=` and echo it:

  ```ts
  // GET /api/orchestrator/node-routing?project=<abs>
  // Read-only view of per-kind provider routing for the 10 standard build node kinds.
  // Mirrors GET style of /level, /pool-size, /effort, /node-profiles (require project, 400, echo project).
  if (url.pathname === '/api/orchestrator/node-routing' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    return Response.json({ project, routing: nodeRoutingTable(project) });
  }
  ```

- No new helpers; reuse the existing `jsonError` (orchestrator-routes.ts:21).
- No change to any POST paths or other GET paths.

**Citations:**
- handleOrchestratorRoutes entry: src/routes/orchestrator-routes.ts:28
- Pattern for project-required GETs (level example): src/routes/orchestrator-routes.ts:30-34
- jsonError: src/routes/orchestrator-routes.ts:21
- Final return null: src/routes/orchestrator-routes.ts:212
- Wiring in server.ts (no change needed): src/server.ts:539-541 (`if (url.pathname.startsWith('/api/orchestrator'))`)

### 3. src/services/__tests__/node-provider.test.ts

**Additive: new assertions inside the existing `describe('nodeRoutingTable', ...)` block (or a follow-on describe). Do not alter prior tests.**

- The test file already imports `nodeRoutingTable` (and others).
- Add tests that:
  1. Call `nodeRoutingTable('/abs/project/path')` (with a dummy absolute project path).
  2. Assert that with no provider config, **all 10 kinds** resolve to `'claude'`.
  3. Under `MERMAID_NODE_PROVIDER=grok-build`, assert that `report` and `driveexec` are still `'claude'` (MCP-forced), while a non-MCP kind (e.g. implement or research) follows to `'grok-build'`.

Suggested minimal additions (exact text can vary; assertions must be present):

```ts
it('nodeRoutingTable(project) defaults all 10 standard build kinds to claude with no config', () => {
  const table = nodeRoutingTable('/tmp/some-project');
  const kinds = ['blueprint','implement','review','research','wimplement','verify','fix','driveplan','report','driveexec'];
  for (const k of kinds) {
    expect(table[k]).toBe('claude');
  }
  expect(Object.keys(table).length).toBeGreaterThanOrEqual(10);
});

it('nodeRoutingTable(project) keeps report/driveexec as claude (mcp-forced) even under grok project default', () => {
  process.env.MERMAID_NODE_PROVIDER = 'grok-build';
  const table = nodeRoutingTable('/tmp/proj');
  expect(table.report).toBe('claude');
  expect(table.driveexec).toBe('claude');
  // a non-mcp kind follows the grok default
  expect(table.implement).toBe('grok-build');
});
```

- Keep using `beforeEach/afterEach(clearEnv)` (already present for the describe).
- No new KEYS needed in clearEnv unless you want to be exhaustive; the existing clear covers the main ones.

**Citations:**
- Current nodeRoutingTable describe: src/services/__tests__/node-provider.test.ts:108
- clearEnv + KEYS: src/services/__tests__/node-provider.test.ts:6
- Existing MCP-forced test pattern: src/services/__tests__/node-provider.test.ts:119-125
- Import line: src/services/__tests__/node-provider.test.ts:2

## Call Sites That Must Continue Working (no breakage)
- src/routes/api.ts:3258: `nodeRoutingTable()` (0-arg) for `/api/leaf-executor/node-routing` — must still return a Record with at least the original keys (now will return the fuller 10-kind map; this is acceptable additive surface).
- src/services/leaf-executor.ts:1013: `resolveNodeProvider(kind, spec.allowedTools)` — untouched.
- All existing node-provider.test.ts tests for resolve* and the old 4-kind nodeRoutingTable() checks.

## Acceptance Criteria (verbatim from query)
- tsc clean
- endpoint returns the routing table: GET /api/orchestrator/node-routing?project=/abs/path → 200 with `{ project: '/abs/path', routing: { blueprint: 'claude', ..., driveexec: 'claude', ... } }`
- mcp-forced kinds (report, driveexec) are always 'claude' (even when MERMAID_NODE_PROVIDER=grok-build)
- New tests in node-provider.test.ts pass

## Verification Steps (read-only inspection + run)
1. `npm run build` or direct `npx tsc --noEmit` (or equivalent) — expect clean.
2. `npm run test:ci -- src/services/__tests__/node-provider.test.ts`
3. Manual curl (after server start) or via the orchestrator-routes.test harness style:
   - GET without project → 400
   - GET with project → 200 + routing with 10 entries, mcp ones = claude

## Size Manifest Notes
- 3 source files edited + 1 blueprint file created = 4 distinct files.
- 3 independent units of work (node-provider helper, orchestrator route addition, node-provider test addition).
- nonEnumerableFanout = false (all call sites and kinds are statically enumerated; no reflective/string-keyed dispatch beyond the existing resolveAllNodeProviders loop over an explicit array of keys).

```json
{ "schemaVersion": 1, "estimatedFiles": 4, "estimatedTasks": 3,
  "nonEnumerableFanout": false,
  "filesToCreate": [".collab/leaf-blueprints/928b78d0-c172-4fb8-8213-db509426f444.md"],
  "filesToEdit": ["src/services/node-provider.ts", "src/routes/orchestrator-routes.ts", "src/services/__tests__/node-provider.test.ts"],
  "tasks": [
    { "id": "node-provider-table", "files": ["src/services/node-provider.ts"], "description": "Add nodeRoutingTable(project) + local FLOOR_ALLOWLISTS for 10 kinds" },
    { "id": "orchestrator-route", "files": ["src/routes/orchestrator-routes.ts"], "description": "Add GET /api/orchestrator/node-routing?project=<abs> mirroring project-required GET style" },
    { "id": "node-provider-test", "files": ["src/services/__tests__/node-provider.test.ts"], "description": "Add assertions: defaults all to claude; report/driveexec mcp-forced claude" }
  ] }
```