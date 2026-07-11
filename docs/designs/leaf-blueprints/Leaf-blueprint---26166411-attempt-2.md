# Blueprint: [grok-exp A] Add resolveAllNodeProviders diagnostic helper

## Context

`src/services/node-provider.ts` already exports `resolveNodeProvider(kind, allowedTools)` which resolves the provider for a single node via a priority chain: MCP-forced claude → per-kind config → project default → claude. This task adds a thin convenience wrapper that maps a list of kinds to their providers in one call — a diagnostics helper for a future status endpoint.

No existing logic changes. Pure additive export.

---

## File 1 — `src/services/node-provider.ts`

### Change: append one exported function at the bottom of the file (after `grokLedgerModel`)

```ts
/**
 * Resolve providers for ALL supplied kinds in one call — diagnostics convenience
 * for a status endpoint that wants to show the full routing table at a glance.
 * Delegates entirely to resolveNodeProvider; no new logic here.
 *
 * @param kinds            e.g. ['blueprint','implement','review','report']
 * @param allowedToolsByKind  map of kind → space-separated tool allowlist string
 *                            (missing key treated as empty / no MCP tools)
 */
export function resolveAllNodeProviders(
  kinds: string[],
  allowedToolsByKind: Record<string, string>,
): Record<string, NodeProvider> {
  const result: Record<string, NodeProvider> = {};
  for (const kind of kinds) {
    result[kind] = resolveNodeProvider(kind, allowedToolsByKind[kind]);
  }
  return result;
}
```

**Exact insertion point:** append after the closing brace of `grokLedgerModel` (currently the last function, ending at line 72). No imports needed — `resolveNodeProvider` and `NodeProvider` are already in scope.

---

## File 2 — `src/services/__tests__/node-provider.test.ts`

### Change: append a new `describe('resolveAllNodeProviders', ...)` block at the bottom of the file (after the `grokLedgerModel` block)

The existing file already imports `resolveNodeProvider` and `anyGrokNodeConfigured` from `'../node-provider'`. Extend the import to also pull in `resolveAllNodeProviders`.

**Import line diff** (line 2):
```ts
// before
import { resolveNodeProvider, anyGrokNodeConfigured, grokLedgerModel } from '../node-provider';
// after
import { resolveNodeProvider, anyGrokNodeConfigured, grokLedgerModel, resolveAllNodeProviders } from '../node-provider';
```

**New describe block to append at end of file:**
```ts
describe('resolveAllNodeProviders', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it('returns claude for every kind when no config is set', () => {
    const result = resolveAllNodeProviders(
      ['blueprint', 'implement', 'review'],
      { blueprint: 'Read Write Bash', implement: 'Read Edit Bash', review: 'Read Bash' },
    );
    expect(result).toEqual({ blueprint: 'claude', implement: 'claude', review: 'claude' });
  });

  it('reflects per-kind and MCP overrides across the full table', () => {
    process.env.MERMAID_NODE_PROVIDER_IMPLEMENT = 'grok-build';
    const result = resolveAllNodeProviders(
      ['blueprint', 'implement', 'report'],
      {
        blueprint: 'Read Write Bash',
        implement: 'Read Edit Bash',
        report: 'Read Grep mcp__mermaid__add_session_todo', // MCP-forced → claude even with project grok
      },
    );
    expect(result.blueprint).toBe('claude');
    expect(result.implement).toBe('grok-build');
    expect(result.report).toBe('claude');
  });

  it('handles an empty kinds array', () => {
    expect(resolveAllNodeProviders([], {})).toEqual({});
  });

  it('treats a missing allowedToolsByKind entry the same as an empty string', () => {
    process.env.MERMAID_NODE_PROVIDER = 'grok-build';
    // kind not in the map → allowedTools is undefined → no MCP tools, follows project default
    const result = resolveAllNodeProviders(['implement'], {});
    expect(result.implement).toBe('grok-build');
  });
});
```

**Existing `KEYS` array** (line 6) already covers `MERMAID_NODE_PROVIDER`, `MERMAID_NODE_PROVIDER_IMPLEMENT`, `MERMAID_NODE_PROVIDER_BLUEPRINT`, and `MERMAID_NODE_PROVIDER_REPORT` — all keys used in the new tests — so no change to `clearEnv` is needed.

---

## Summary of changes

| File | Kind | Description |
|------|------|-------------|
| `src/services/node-provider.ts` | edit | Append `resolveAllNodeProviders` exported function (8 lines) |
| `src/services/__tests__/node-provider.test.ts` | edit | Extend import line + append 4-test `describe` block |

No new files. No behavioural change to any existing export.

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "src/services/node-provider.ts",
    "src/services/__tests__/node-provider.test.ts"
  ],
  "tasks": [
    { "id": "add-helper", "files": ["src/services/node-provider.ts"], "description": "Append resolveAllNodeProviders exported function after grokLedgerModel" },
    { "id": "add-tests", "files": ["src/services/__tests__/node-provider.test.ts"], "description": "Extend import + append resolveAllNodeProviders describe block with 4 unit tests" }
  ] }
```
