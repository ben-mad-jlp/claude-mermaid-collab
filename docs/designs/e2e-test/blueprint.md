# Blueprint: Session Display Name Badge

## Source Artifacts
- feature-spec
- architecture-notes

---

## 1. Structure Summary

### Files

- [ ] `src/routes/api.ts` — Add displayName computation to GET /api/session-state
- [ ] `src/mcp/tools/collab-state.ts` — Add displayName to CollabState interface, compute in getSessionState()
- [ ] `ui/src/components/dashboard/SessionCard.tsx` — Render displayName badge

### Type Definitions

```typescript
// Addition to CollabState in src/mcp/tools/collab-state.ts
export interface CollabState {
  // ... existing fields
  displayName?: string; // Human-readable name computed from state
}
```

### Component Interactions

```
collab-state.json (disk, no displayName stored)
  → getSessionState() reads file, computes displayName from state field
  → GET /api/session-state returns JSON with displayName
  → SessionCard renders badge with displayName text
```

---

## 2. Function Blueprints

### `computeDisplayName(state: string | undefined, fallback: string): string`

**Pseudocode:**
1. If state is set, replace hyphens with spaces, title-case each word
2. Else return fallback (session name)

**Error handling:** None needed — pure string transform
**Edge cases:** Empty string state → fall back. Undefined state → fall back.
**Test strategy:** Unit test with various state values

### `getSessionState()` — modification

**Pseudocode:**
1. Read collab-state.json from disk
2. Parse JSON
3. If displayName not already set AND state field exists → compute displayName
4. Else if displayName not set → use session name as fallback
5. Return state object with displayName

### `GET /api/session-state` — modification

**Pseudocode:**
1. Read collab-state.json (check new path, then old path)
2. Parse JSON
3. Compute displayName inline (same logic as getSessionState)
4. Return response

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: update-collab-state-interface
    files: [src/mcp/tools/collab-state.ts]
    tests: [src/__tests__/collab-state.test.ts]
    description: "Add displayName to CollabState interface and compute it in getSessionState()"
    parallel: true
    depends-on: []

  - id: update-api-endpoint
    files: [src/routes/api.ts]
    tests: []
    description: "Add displayName computation to GET /api/session-state endpoint"
    parallel: true
    depends-on: []

  - id: update-session-card
    files: [ui/src/components/dashboard/SessionCard.tsx]
    tests: []
    description: "Render displayName badge in SessionCard component"
    parallel: false
    depends-on: [update-collab-state-interface, update-api-endpoint]

  - id: verify-build
    files: []
    tests: []
    description: "Run TypeScript build and tests to verify everything compiles"
    parallel: false
    depends-on: [update-session-card]
```

### Execution Waves

**Wave 1 (parallel):**
- update-collab-state-interface, update-api-endpoint

**Wave 2 (depends on Wave 1):**
- update-session-card

**Wave 3 (depends on Wave 2):**
- verify-build

### Summary
- Total tasks: 4
- Total waves: 3
- Max parallelism: 2 (Wave 1)
