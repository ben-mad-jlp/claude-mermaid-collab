# Blueprint — [grok-exp E] Add a pure `providerLabel(p)` helper to node-provider.ts

## Goal
Add an exported pure function `providerLabel(p: NodeProvider): string` to
`src/services/node-provider.ts` mapping each provider to a human label, plus 3 unit
tests. Pure, additive, no behaviour change.

## Files to touch
1. **EDIT** `src/services/node-provider.ts` — widen the `NodeProvider` union and add `providerLabel`.
2. **EDIT** `src/services/__tests__/node-provider.test.ts` — add 3 tests.

## Required change shape

### 1. `src/services/node-provider.ts`

**a) Widen the union (line 23)** so the `'grok-api'` case is type-legal. This is
purely additive — no existing function constructs `'grok-api'` (`asProvider` only
accepts `'grok-build'|'claude'`; `isGrokProvider` returns `p !== 'claude'`, which
stays correct for the new member). Change:

```ts
export type NodeProvider = 'claude' | 'grok-build';
```
to:
```ts
export type NodeProvider = 'claude' | 'grok-build' | 'grok-api';
```

**b) Add the helper** (place it right after `isGrokProvider`, ~line 30). Use an
exhaustive `switch` so tsc proves every union member is handled (no `default` needed;
the function is total over the 3-member union):

```ts
/** Pure human-readable label for a node provider. No I/O, pure on its argument. */
export function providerLabel(p: NodeProvider): string {
  switch (p) {
    case 'claude':     return 'Claude';
    case 'grok-build': return 'Grok Build';
    case 'grok-api':   return 'Grok 4.3';
  }
}
```

> Note: with the union widened to exactly these three members, the switch is
> exhaustive and tsc requires no fallthrough return. Do NOT add a `default` branch —
> it would mask a future missing case.

### 2. `src/services/__tests__/node-provider.test.ts`

Add `providerLabel` to the existing import list on line 2 (alongside
`isGrokProvider, type NodeProvider`). Then append a new `describe` block (uses the
already-imported `describe, it, expect` from `bun:test`):

```ts
describe('providerLabel', () => {
  it('labels claude', () => {
    expect(providerLabel('claude')).toBe('Claude');
  });
  it('labels grok-build', () => {
    expect(providerLabel('grok-build')).toBe('Grok Build');
  });
  it('labels grok-api', () => {
    expect(providerLabel('grok-api')).toBe('Grok 4.3');
  });
});
```

Because `NodeProvider` is widened, the three literal arguments are all assignable —
no casts needed.

## Acceptance
- `npx tsc --noEmit` (or project's tsc check) clean — in particular the widened union
  must not break any exhaustive switch elsewhere (there is none on `NodeProvider`
  today; verify with a grep for `switch` over a NodeProvider value — none exists).
- New tests pass: `npm run test:ci -- src/services/__tests__/node-provider.test.ts`
  (bun:test file → run via the bun runner per the dual-test-runner setup).

## Notes / constraints
- No behaviour change to `resolveNodeProvider`, `anyGrokNodeConfigured`, or routing.
- Pure function: no config/env reads, no logging.
- Single source file + its test, as specified.

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/node-provider.ts", "src/services/__tests__/node-provider.test.ts"],
  "tasks": [
    { "id": "add-provider-label", "files": ["src/services/node-provider.ts"], "description": "Widen NodeProvider union to include 'grok-api' and add exported pure providerLabel(p) with exhaustive switch returning Claude/Grok Build/Grok 4.3" },
    { "id": "add-tests", "files": ["src/services/__tests__/node-provider.test.ts"], "description": "Import providerLabel and add a describe block with 3 it() cases covering claude, grok-build, grok-api" }
  ] }
```