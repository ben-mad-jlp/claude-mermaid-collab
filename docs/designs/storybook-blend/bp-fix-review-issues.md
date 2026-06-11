# Blueprint: Fix Review Issues

## Source Artifacts
- design-fix-review-issues — Fix specifications for bugs and gaps from review

## 1. Structure Summary

### Files
- [ ] `src/routes/api.ts` — Fix create return value (Bug 1+5), fix type annotations (Bug 2)
- [ ] `src/mcp/tools/embed.ts` — Fix width/height schema types + handler signature (Bug 3)
- [ ] `ui/src/api/embeds.ts` — Fix URL paths to match server routes (Gap 3)
- [ ] `src/services/__tests__/embed-manager.test.ts` — Create test file (Gap 1)

### Component Interactions
All fixes are independent — no cross-file dependencies between the bug fixes. The test file (Gap 1) tests the already-implemented embed-manager.

---

## 2. Function Blueprints

### Fix: `api.ts` POST embed route (Bug 1 + Bug 2 + Bug 5)

**Changes at lines 1962-1989:**
1. Fix type annotation: `width`/`height` from `number` to `string`, `storybook` from `boolean` to `{ storyId: string; port: number }`
2. Change `const id = await embedManager.create(...)` to `const embed = await embedManager.create(...)`
3. Use `embed.id` in broadcast and response
4. Use `embed.createdAt` instead of `new Date().toISOString()` in broadcast

### Fix: `embed.ts` schemas (Bug 3)

**Changes at lines 54-55:**
1. Change `width` schema type from `'number'` to `'string'`, update description
2. Change `height` schema type from `'number'` to `'string'`, update description
3. Change `handleCreateEmbed` signature: `width?: number` → `width?: string`, `height?: number` → `height?: string`

### Fix: `embeds.ts` API URLs (Gap 3)

**fetchEmbeds:** Change `/api/sessions/{session}/embeds?project=` to `/api/embeds?project=...&session=...`
**deleteEmbed:** Change `/api/sessions/{session}/embeds/{id}?project=` to `/api/embed/{id}?project=...&session=...`

### New: `embed-manager.test.ts` (Gap 1)

Test suite covering: create (basic, URL validation, ID dedup, storybook metadata), list (returns sorted), get (by ID, unknown returns null), delete (removes, throws on unknown), initialize (reloads from disk).

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: fix-api-routes
    files: [src/routes/api.ts]
    tests: []
    description: "Fix embedManager.create() return handling (Bug 1+5), fix type annotations (Bug 2)"
    parallel: true
    depends-on: []

  - id: fix-mcp-schemas
    files: [src/mcp/tools/embed.ts]
    tests: []
    description: "Fix width/height schema types from number to string, update handler signature (Bug 3)"
    parallel: true
    depends-on: []

  - id: fix-api-client-urls
    files: [ui/src/api/embeds.ts]
    tests: []
    description: "Fix fetchEmbeds and deleteEmbed URLs to match server routes (Gap 3)"
    parallel: true
    depends-on: []

  - id: create-embed-tests
    files: [src/services/__tests__/embed-manager.test.ts]
    tests: [src/services/__tests__/embed-manager.test.ts]
    description: "Create EmbedManager test suite with vitest (Gap 1)"
    parallel: true
    depends-on: []
```

### Execution Waves

**Wave 1 (parallel):**
- fix-api-routes, fix-mcp-schemas, fix-api-client-urls, create-embed-tests

### Summary
- Total tasks: 4
- Total waves: 1
- Max parallelism: 4