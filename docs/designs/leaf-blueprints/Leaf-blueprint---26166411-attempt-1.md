The blueprint file already exists and is complete and correct (it matches the real code at `src/services/node-provider.ts:83-92` and the tests at `src/services/__tests__/node-provider.test.ts:69-106`). The worktree was removed mid-session, but the blueprint persists in `.collab/leaf-blueprints/`. Emitting it verbatim as the final message:

---

# Blueprint: resolveAllNodeProviders diagnostic helper

## Objective

Add a pure, additive exported helper `resolveAllNodeProviders` to
`src/services/node-provider.ts` that maps an array of node kinds to their
resolved `NodeProvider` values. No existing behavior changes. Also add two
focused unit tests in the existing test file.

> ⚠️ **Verify-first note:** in the current tree this helper is already present at
> `src/services/node-provider.ts:83-92` and tested at
> `src/services/__tests__/node-provider.test.ts:69-106`. The executor should
> read both files first; if they already match this blueprint, the correct
> action is a **no-op** — run the test suite to confirm green and report
> complete. Apply the change shape below only if the symbol/tests are absent.

---

## Files to touch

| File | Action |
|------|--------|
| `src/services/node-provider.ts` | Add exported helper (4–6 lines) |
| `src/services/__tests__/node-provider.test.ts` | Add `describe('resolveAllNodeProviders', …)` block (2 tests) |

---

## 1. `src/services/node-provider.ts`

### Where to insert

Append after `grokLedgerModel` (currently line 70–72), before the end of file.

### Exact change shape

```ts
/**
 * Resolve providers for ALL given node kinds at once.
 * allowedToolsByKind maps kind → its tool allowlist string (same semantics as
 * resolveNodeProvider's second arg). Returns a full routing-table snapshot —
 * useful for status endpoints and diagnostics.
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

Key properties:
- Delegates entirely to the existing `resolveNodeProvider` — no duplicated logic.
- `allowedToolsByKind[kind]` is `undefined` when the caller omits a kind entry;
  `resolveNodeProvider` already handles `undefined` allowedTools via `?? ''`.
- Return type is `Record<string, NodeProvider>` (not `Record<string, string>`)
  so callers get the narrowed union type.

---

## 2. `src/services/__tests__/node-provider.test.ts`

### Where to insert

Append a new `describe` block after the existing `grokLedgerModel` block (after
line 67). The `KEYS` array and `clearEnv` helper at the top of the file are
already in scope.

### Exact change shape

```ts
describe('resolveAllNodeProviders', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it('maps every supplied kind through resolveNodeProvider (all default claude)', () => {
    const table = resolveAllNodeProviders(
      ['blueprint', 'implement', 'review'],
      { blueprint: 'Read Write Bash', implement: 'Read Edit Bash', review: 'Read Grep Bash' },
    );
    expect(table).toEqual({ blueprint: 'claude', implement: 'claude', review: 'claude' });
  });

  it('respects per-kind config and MCP guard within the full table', () => {
    process.env.MERMAID_NODE_PROVIDER_IMPLEMENT = 'grok-build';
    const table = resolveAllNodeProviders(
      ['blueprint', 'implement', 'report'],
      {
        blueprint: 'Read Write Bash',
        implement: 'Read Edit Bash',
        report: 'Read Grep mcp__mermaid__add_session_todo', // MCP-forced → claude
      },
    );
    expect(table).toEqual({ blueprint: 'claude', implement: 'grok-build', report: 'claude' });
  });
});
```

Also update the import line at the top of the test file to include the new export:

```ts
import { resolveNodeProvider, anyGrokNodeConfigured, grokLedgerModel, resolveAllNodeProviders } from '../node-provider';
```

---

## Implementation notes

- **No new imports** in `node-provider.ts` — the helper calls `resolveNodeProvider`
  which is already defined in the same file.
- **No config-file mock needed** in tests — the existing `clearEnv` pattern
  (which zeroes `process.env` for all `MERMAID_NODE_PROVIDER*` keys) is
  sufficient because `cfg()` falls through to env when `config.json` has no
  matching key (true in CI).
- **Test runner**: `bun:test` (same as existing tests in this file).
- **Linting/types**: `kinds` is `string[]` (not `GrokNodeKind[]`) for maximum
  flexibility — a status endpoint may pass arbitrary kind strings.

---

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "src/services/node-provider.ts",
    "src/services/__tests__/node-provider.test.ts"
  ],
  "tasks": [
    { "id": "add-helper", "files": ["src/services/node-provider.ts"], "description": "Add exported resolveAllNodeProviders helper after grokLedgerModel" },
    { "id": "add-tests", "files": ["src/services/__tests__/node-provider.test.ts"], "description": "Add resolveAllNodeProviders describe block (2 tests) and update import" }
  ] }
```