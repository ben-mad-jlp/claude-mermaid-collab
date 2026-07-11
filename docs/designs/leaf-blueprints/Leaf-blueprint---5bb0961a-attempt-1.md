# Blueprint — Z6: Add `summary` node kind to the node-profile system

## Goal
Add a new leaf-executor node kind `summary` (Zen-mode session summarizer, Phase 4 prep of
design-zen-mode) with model default `claude-sonnet-4-6`, appropriate `allowedTools`/`effort`,
and have it flow through the existing per-project override system
(`listNodeProfileOverrides`/`setNodeProfileOverride`) and the node-profile editor UI.

Consumed by Z7 (which will wire the actual summary prompt + routing). **This task is a
config-only addition — do NOT add prompt logic, routing, or any execution wiring.**

## Key finding — the change is almost entirely in ONE file
Everything that lists node kinds derives from the `LeafNodeKind` union and the
`LEAF_NODE_KINDS` array in `src/services/leaf-executor.ts`:

- `NODE_KIND_DESCRIPTIONS` and `NODE_PROFILE` are `Record<LeafNodeKind, …>` → TypeScript will
  FORCE us to add a `summary` entry (good — compile-time exhaustiveness).
- The override storage (`orchestrator-config.ts`) is **string-keyed** (`kind: string`), so it
  needs NO change — it already stores/returns any kind.
- The HTTP routes (`orchestrator-routes.ts`) validate `kind` against `LEAF_NODE_KINDS` and build
  the editor rows by mapping over `LEAF_NODE_KINDS`. Adding to the array auto-includes `summary`
  in both GET (editor rows) and POST (accepted kind). No route edit needed.
- The UI (`ui/src/components/settings/DaemonNodesMatrix.tsx` / `TieringEditor.tsx`) is fully
  data-driven from the GET `/api/orchestrator/node-profiles` `rows`. Adding the kind to the
  array auto-surfaces a new editor row. No UI edit needed.
- `buildNodePrompt` has a `default:` that throws for unhandled kinds, so adding `summary` to the
  union does NOT break compilation. (Z7 will add the actual summary prompt path; until then
  `summary` is config-only and is never routed through `buildNodePrompt`.)

## Model value decision
The `NODE_PROFILE` table uses model ALIASES (`opus`/`sonnet`/`haiku`), and the alias `sonnet`
resolves to `claude-sonnet-4-6` (`DEFAULT_MODEL_BY_PROVIDER.claude === 'claude-sonnet-4-6'`,
confirmed in `src/agent/worker-core/__tests__/resolve-model.test.ts:49`). The editor's model
dropdown choices are `MODEL_CHOICES = ['opus','sonnet','haiku']`
(`src/routes/orchestrator-routes.ts:20`).

→ Use `model: 'sonnet'` for the `summary` profile. This is exactly `claude-sonnet-4-6` at
resolution time AND is a selectable override option in the editor (a raw id would not appear in
the dropdown). This matches the spec intent ("default claude-sonnet-4-6, overridable per
project like other node kinds").

## Exact changes — `src/services/leaf-executor.ts`

### 1. Extend the `LeafNodeKind` union (lines 40–43)
Add `summary` as its own group (Zen mode). After the verify-pipeline line:
```ts
export type LeafNodeKind =
  | 'blueprint' | 'implement' | 'review' // floor (unchanged)
  | 'research' | 'wimplement' | 'verify' | 'fix' // waves (P5)
  | 'driveplan' | 'driveexec' | 'report' // verify pipeline (epic f5c7fc46)
  | 'summary'; // zen mode (design-zen-mode Phase 4): session-summary model knob
```

### 2. Add to `LEAF_NODE_KINDS` (lines 280–284)
Append `summary` after `report` (stable display order = bottom of the matrix):
```ts
export const LEAF_NODE_KINDS: LeafNodeKind[] = [
  'blueprint', 'implement', 'review',
  'research', 'wimplement', 'verify', 'fix',
  'driveplan', 'driveexec', 'report',
  'summary',
];
```

### 3. Add to `NODE_KIND_DESCRIPTIONS` (lines 287–298)
```ts
  summary: 'Zen mode: summarizes a watched interactive session into a short progress summary.',
```

### 4. Add to `NODE_PROFILE` (lines 300–319)
Read-only summarizer (no Write/Edit/Bash needed — it reads captured text and emits the summary
as its final message). Default model `sonnet` (= claude-sonnet-4-6), low effort (cheap, runs on
the structural heartbeat cadence):
```ts
  // zen mode (design-zen-mode Phase 4): summarizes a watched session's progress. Read-only;
  // emits the summary as its final message (consumed by Z7). Default sonnet (claude-sonnet-4-6).
  summary: { model: 'sonnet', allowedTools: 'Read Grep Glob', effort: 'low' },
```

## Verification (no new tests required; optional sanity)
- `npx tsc --noEmit -p tsconfig.json` from repo root — the two `Record<LeafNodeKind, …>` tables
  guarantee compile failure if any field is missed; a clean compile proves completeness.
- Existing tests stay green: `orchestrator-routes.test.ts` keys off `kind === 'blueprint'`;
  `orchestrator-config.test.ts` uses string kinds. Neither asserts the kind set is closed.
- Optional manual check: `GET /api/orchestrator/node-profiles?project=<p>` now returns a
  `summary` row with `defaultModel: 'sonnet'`, `defaultEffort: 'low'`; `POST` with
  `kind: 'summary'` is accepted and persists an override.

## Out of scope (Z7)
- The summary node's prompt (a `buildNodePrompt`/dedicated builder case).
- Routing/dispatch that actually spawns a `summary` node.
- Any consumption of `session_summary_updated` / pane-capture text.

```json
{ "schemaVersion": 1, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/leaf-executor.ts"],
  "tasks": [
    { "id": "add-summary-node-kind", "files": ["src/services/leaf-executor.ts"], "description": "Add 'summary' to LeafNodeKind union, LEAF_NODE_KINDS array, NODE_KIND_DESCRIPTIONS, and NODE_PROFILE (model 'sonnet'=claude-sonnet-4-6, allowedTools 'Read Grep Glob', effort 'low'); override system + routes + UI auto-pick it up." }
  ] }
```
