# Blueprint: Surface cache tokens in leaf_inspect cost rollup

## Goal

Add `cacheReadTokens` and `cacheCreationTokens` roll-up totals to the `LeafRunStats`
object returned by `getLeafRun()` in `src/services/ledger-stats.ts`. These fields are
already persisted per-node by the ledger (commit 56ecef0f) and already present on
`LeafNodeStat`; they just need to be summed to the run level. The `leaf_inspect` MCP
handler spreads `run` directly (`{ ran: true, ...run, nodes }` at setup.ts:4843), so
the new fields appear in the tool output automatically — no change to setup.ts.

## Files to touch

**Single file:** `src/services/ledger-stats.ts`

## Exact changes

### 1. Extend the `LeafRunStats` interface (lines 50–77)

Add two new fields immediately after `rateLimitedCount` (line ~61), before `authModes`:

```ts
// BEFORE (excerpt):
  rateLimitedCount: number;
  authModes: Record<string, number>;

// AFTER:
  rateLimitedCount: number;
  cacheReadTokens: number;     // Σ cacheReadTokens across all node rows (legacy null → 0)
  cacheCreationTokens: number; // Σ cacheCreationTokens across all node rows (legacy null → 0)
  authModes: Record<string, number>;
```

### 2. Compute the sums in `getLeafRun()` (lines 120–201)

After the existing `rateLimitedCount` computation at line ~161, add:

```ts
// BEFORE (excerpt):
  const rateLimitedCount = nodeRows.filter((r) => r.rateLimited === true).length;

  const authModes: Record<string, number> = {};

// AFTER:
  const rateLimitedCount = nodeRows.filter((r) => r.rateLimited === true).length;

  const cacheReadTokens = nodeRows.reduce((s, r) => s + (r.cacheReadTokens ?? 0), 0);
  const cacheCreationTokens = nodeRows.reduce((s, r) => s + (r.cacheCreationTokens ?? 0), 0);

  const authModes: Record<string, number> = {};
```

### 3. Include in the returned object (lines ~185–200)

```ts
// BEFORE (excerpt):
  return {
    leafId,
    ...
    rateLimitedCount,
    authModes,
    ...
  };

// AFTER:
  return {
    leafId,
    ...
    rateLimitedCount,
    cacheReadTokens,
    cacheCreationTokens,
    authModes,
    ...
  };
```

## Back-compat / legacy rows

`r.cacheReadTokens ?? 0` and `r.cacheCreationTokens ?? 0` coerce `null`/`undefined`
(pre-56ecef0f ledger rows) to `0`, so the rollup never throws and old runs just show
`cacheReadTokens: 0`.

## What this does NOT touch

- `src/mcp/setup.ts` — `leaf_inspect` spreads `run` already; new fields appear for free.
- `src/services/worker-ledger.ts` — schema already has both columns.
- `FleetStats` / `getFleetStats()` — out of scope for this leaf (fleet rollup is a separate surface).
- `listLeafRuns()` / `LeafRunSummary` — also out of scope; that's the triage list, not inspect.
- No DB migration — columns already exist.

## Verification

After applying:
```bash
npx tsc --noEmit   # type-check passes
```
And manually: call `leaf_inspect` on a recent leaf that ran post-56ecef0f; confirm
`cacheReadTokens` and `cacheCreationTokens` appear as numeric fields at the run level.

```json
{ "schemaVersion": 1, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [], "filesToEdit": ["src/services/ledger-stats.ts"],
  "tasks": [
    { "id": "cache-token-rollup", "files": ["src/services/ledger-stats.ts"], "description": "Add cacheReadTokens + cacheCreationTokens sum fields to LeafRunStats interface and getLeafRun() return value" }
  ] }
```
