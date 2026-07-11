# POOL-1 — Worker-pool config + descriptive typed session naming

Implements POOL-1 of the Worker Pool epic (design: `design-typed-session-pool`). Pure config + in-memory registry — NO tmux/launch/coordinator side effects (those are POOL-3/POOL-4). Existing spawn behavior unchanged.

## Files
- `src/services/worker-pool.ts` (new) — pool model.
- `src/services/__tests__/worker-pool.test.ts` (new) — focused unit tests.

## Design decisions honored
- Descriptive session names (`frontend-1`, …) instead of `worker-<id8>`.
- `general` pool type absorbs `default`/untyped/unknown/multi-domain (Q5).
- 1 slot per type (the parallelism dial), structured as an overridable map.
- Type taxonomy reuses `agent-profiles` (`AgentProfileType`); PATH_RULES inference is NOT duplicated — `poolTypeForFiles` delegates to `inferProfileType`.

## Exported API surface
Types:
- `type PoolType = 'frontend'|'backend'|'api'|'ui'|'library'|'general'`
- `type PoolConfig = Record<PoolType, number>`
- `type SlotStatus = 'idle'|'busy'`
- `interface PoolSlot { type: PoolType; slot: number; status: SlotStatus; currentTodoId?: string }`

Constants:
- `const POOL_TYPES: readonly PoolType[]`
- `const DEFAULT_SLOTS_PER_TYPE = 1`
- `const POOL_CONFIG: PoolConfig` (1 per type)

Functions (signatures for POOL-4):
- `poolSessionName(type: PoolType, slot = 1): string`
- `todoTypeToPoolType(todoType?: string | null): PoolType`
- `profileTypeToPoolType(profileType: AgentProfileType): PoolType`
- `poolTypeForFiles(files: string[] | undefined | null): PoolType`
- `getOrCreateSlot(type: PoolType, config: PoolConfig = POOL_CONFIG): PoolSlot | undefined`
- `findIdleSessionForType(type: PoolType): string | undefined`
- `markBusy(sessionName: string, todoId: string): PoolSlot | undefined`
- `markIdle(sessionName: string): PoolSlot | undefined`
- `listPool(): Record<string, PoolSlot>`
- `resetPool(): void` (test helper)

## Registry semantics
Module-level `Map<sessionName, PoolSlot>`, no DB. `getOrCreateSlot` returns an existing idle slot if present, else lazily creates the next slot index within the type's budget (`config[type]`), else `undefined` (at capacity). `listPool` returns shallow copies (no aliasing into the registry).

## Verification
- `bun test src/services/__tests__/worker-pool.test.ts` → 13 pass / 0 fail (44 assertions).
- `npx tsc --noEmit` → clean (0 errors).

Not committed. `complete_todo` not called.
