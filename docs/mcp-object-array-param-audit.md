# MCP Object-Array Parameter Audit

Comprehensive audit of all `items: { type: 'object' }` array parameters across the MCP tool surface, tracking which ones are guarded by `coerceArrayArg` to handle stringified-array marshaling from clients.

## Audit Table

| File | Line | Tool Name | Parameter Name | Coercion Status |
|------|------|-----------|-----------------|-----------------|
| src/mcp/mission-tools.ts | 32 | `forge_mission` | `constraints` | **newly-coerced-by-this-leaf** |
| src/mcp/mission-tools.ts | 32 | `forge_mission` | `rejectedAlternatives` | **newly-coerced-by-this-leaf** |
| src/mcp/mission-tools.ts | 44 | `set_mission_criterion` | `panelVerdicts` | coerced (via `normalizePanelVerdicts` in criterion-verify-panel.ts:134, called at mission-tools.ts dispatch layer) |
| src/mcp/snippet.ts | 75 | `create_snippet` | `tags` | **newly-coerced-by-this-leaf** |
| src/mcp/snippet.ts | 86 | `update_snippet` | `tags` | **newly-coerced-by-this-leaf** |
| src/mcp/tools/browser.ts | 698 | `browser_save_setup` | `steps` | **newly-coerced-by-this-leaf** |
| src/mcp/tools/browser.ts | 700 | `browser_save_setup` | `parameters` | **newly-coerced-by-this-leaf** |
| src/mcp/setup.ts | 943 | `escalation_create` | `options` | coerced (via `coerceArrayArg` in setup.ts:1945) |
| src/mcp/setup.ts | 973 | `submit_reconcile_result` | `mergedGraph` | coerced (via `coerceArrayArg` in setup.ts:2448) |
| src/mcp/setup.ts | 973 | `submit_reconcile_result` | `newConstraints` | coerced (via `coerceArrayArg` in setup.ts:2449) |

## Coverage Summary

**Total object-array params:** 10

**Coercion status:**
- **Coerced (existing):** 3 (`panelVerdicts`, `options`, `mergedGraph`, `newConstraints`)
- **Coerced (newly-fixed this leaf):** 5 (`constraints`, `rejectedAlternatives`, `tags` × 2, `steps`, `parameters`)
- **Coverage:** 100% (all 10 params are now guarded)

## Newly Coerced Parameters (This Leaf)

### `forge_mission` (mission-tools.ts:85–90)
- **constraints** — array of locked invariant rules
- **rejectedAlternatives** — array of design decisions whose rejected options are no-longer-re-propose
- **Coercion location:** mission-tools.ts:87–88, before `forgeMission()` call
- **Regression test:** src/mcp/__tests__/arg-coercion-surface.test.ts

### Snippet Tools (snippet-tools.ts:196–214)
- **tags** (both `create_snippet`/`add_design_snippet` and `update_snippet`)
- Array of `{ type, value }` objects to associate with snippet content
- **Coercion location:** snippet-tools.ts:205 (create), 212 (update), forwarded as 5th arg to handlers
- **Regression test:** src/mcp/__tests__/arg-coercion-surface.test.ts

### `browser_save_setup` (browser-tools.ts:238–242)
- **steps** — required array of SetupStep objects defining the automation sequence
- **parameters** — optional array of `{ name, default? }` declaring input parameters
- **Coercion location:** browser-tools.ts:240–241, before `browserSaveSetup()` call
- **Guard:** `steps` throws if coercion yields undefined (required by schema)
- **Regression test:** src/mcp/__tests__/arg-coercion-surface.test.ts

## Existing Coercion References

### `panelVerdicts` (mission-tools.ts:44)
- Array of `{ lens, met, reason }` verdicts for high-stakes criterion decisions
- **Coercion:** via `normalizePanelVerdicts()` (criterion-verify-panel.ts:134), called at dispatch layer
- **Regression test:** criterion-verify-panel.test.ts:188–218 (not duplicated in arg-coercion-surface.test.ts)

### `options` (setup.ts:943)
- Array of `{ id, label, detail? }` structured choices for A/B decisions
- **Coercion location:** setup.ts:1945, `coerceArrayArg(rest.options, 'options')`

### `mergedGraph` & `newConstraints` (setup.ts:973)
- Reconciliation results: merged plan graph nodes + new constraints from merge
- **Coercion location:** setup.ts:2448–2449
  - `const mergedGraph = coerceArrayArg(args.mergedGraph, 'mergedGraph');`
  - `const newConstraints = coerceArrayArg(args.newConstraints, 'newConstraints');`

## Fail-Closed Behavior

All `coerceArrayArg` calls enforce **fail-closed** semantics:
1. If `raw` is `undefined` or `null`, return `undefined` (do not error)
2. If `raw` is a string:
   - Try to parse as JSON
   - **Throw** if parse fails (fail-closed, not silent fallback)
3. If parsed value is not an array:
   - **Throw** with paramName (fail-closed)
4. If `raw` is already an array, pass through unchanged

This ensures MCP clients that mistakenly stringify an array (vs sending it directly) get a clear error message rather than a silent malfunction downstream.
