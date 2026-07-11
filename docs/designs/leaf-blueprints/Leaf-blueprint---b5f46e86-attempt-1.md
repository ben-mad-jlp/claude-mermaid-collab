# Blueprint: [grok-exp F] Add `isClaudeProvider(p)` to node-provider.ts

## Goal
Add an exported pure predicate `isClaudeProvider(p: NodeProvider): boolean` that returns
`true` only for `'claude'`. Pure, additive, no behaviour change. It is the exact mirror of
the existing `isGrokProvider` (`src/services/node-provider.ts:28-30`).

This is a pipeline-exercise task (blueprint=claude, implement=grok-build, review=grok-4.3)
to confirm no wasteful re-blueprint on the ENOENT fix.

## Files to edit (2 total, no new files)

### 1. `src/services/node-provider.ts`
Insert a new exported function immediately AFTER the existing `isGrokProvider` block (after
line 30, before the `providerLabel` block on line 32). `NodeProvider` is already defined at
line 23 (`'claude' | 'grok-build' | 'grok-api'`).

```ts
/** Pure predicate: true ONLY for the 'claude' lane, false for any grok lane.
 *  Exact mirror / logical negation of isGrokProvider. No I/O, pure on its argument. */
export function isClaudeProvider(p: NodeProvider): boolean {
  return p === 'claude';
}
```

### 2. `src/services/__tests__/node-provider.test.ts`
- Add `isClaudeProvider` to the existing import from `'../node-provider'` on line 2 (it already
  imports `isGrokProvider, providerLabel, type NodeProvider`).
- Add a new `describe('isClaudeProvider', …)` block (mirror the `isGrokProvider` block at
  lines 145-157). Test runner is `bun:test` (already imported line 1). Required cases per
  acceptance: claude→true, grok-build→false.

```ts
describe('isClaudeProvider', () => {
  it('true for the claude lane', () => {
    expect(isClaudeProvider('claude')).toBe(true);
  });
  it('false for grok-build', () => {
    expect(isClaudeProvider('grok-build')).toBe(false);
  });
});
```

## Acceptance
- `npx tsc --noEmit` (or project tsc) clean.
- New tests pass: `npm run test:ci -- src/services/__tests__/node-provider.test.ts`.

## Notes / constraints
- Pure function, no config/env/I/O. Do not modify any existing function or the resolution logic.
- Keep the exact insertion point so the file stays grouped (predicates together, label after).

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/node-provider.ts", "src/services/__tests__/node-provider.test.ts"],
  "tasks": [ { "id": "add-isclaudeprovider", "files": ["src/services/node-provider.ts", "src/services/__tests__/node-provider.test.ts"], "description": "Add exported pure isClaudeProvider(p) returning p==='claude' plus 2 unit tests (claude→true, grok-build→false)" } ] }
```