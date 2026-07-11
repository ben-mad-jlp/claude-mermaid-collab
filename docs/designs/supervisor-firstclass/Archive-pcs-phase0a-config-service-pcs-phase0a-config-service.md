# Blueprint: PCS Phase 0a — config service (+ fix XAI key via config)

## Source Artifacts
- design-pcs-open-problems (config/secrets; the no-SDK final resolution), the Phase 0 grounding memo, the desktop-env XAI bug todo.
- Grounded in `src/mcp/setup.ts` (consult_grok reads `process.env.XAI_API_KEY`), `src/config.ts` (frozen env constants — NOT touched here).

## Scope guard
This slice is the **testable core of Phase 0**: a config service + routing the XAI key read through it. This alone fixes the desktop XAI-key bug — the server reads the key from `~/.mermaid-collab/config.json` directly (no Electron spawn-env change needed). DEFERRED to a later slice: the Settings-UI "Secrets" tab (safeStorage), the desktop spawn-env injection (now unnecessary for the bug), the single-writer assertion (no write-handler to guard yet; cross-machine writes don't exist), and Electron lifecycle decouple. Do NOT touch `src/config.ts` frozen constants (init-ordering risk), the desktop, or the UI.

---

## 1. Structure Summary

### Files
- [ ] `src/services/config-service.ts` — NEW: `getConfig(key, fallback?)` with precedence env → `~/.mermaid-collab/config.json` → fallback; cached file read; test override hook. (CREATE)
- [ ] `src/services/__tests__/config-service.test.ts` — NEW tests. (CREATE)
- [ ] `src/mcp/setup.ts` — route the consult_grok `XAI_API_KEY` read through `getConfig`. (MODIFY)

### Type Definitions / API
```ts
export function getConfig(key: string, fallback?: string): string | undefined;
export function _resetConfigCache(): void; // tests
// config path = process.env.MERMAID_CONFIG_PATH ?? ~/.mermaid-collab/config.json
```

### Component Interactions
Any server-side secret/config read goes through `getConfig` instead of `process.env` directly. The global `~/.mermaid-collab/config.json` is read by the server process regardless of how it was launched (GUI or CLI), which is why this fixes the desktop bug without an Electron change. `config.ts` frozen constants stay as-is (migrate later, incrementally).

---

## 2. Function Blueprints

### `getConfig(key, fallback?): string | undefined`
**Pseudocode:** if `process.env[key]` is set and non-empty → return it (env wins). Else load+cache the JSON at `configPath()` (`process.env.MERMAID_CONFIG_PATH ?? join(homedir(),'.mermaid-collab','config.json')`); if file value is a non-empty string → return it. Else return `fallback`.
**Error handling:** missing file → treat as `{}`; malformed JSON → catch → `{}` (never throw). Cache the parsed object (module-level) so repeated reads are cheap.
**Edge cases:** empty-string env value → falls through to file (treat '' as unset); non-string file value → ignored; `fallback` undefined → returns undefined.
**Test strategy:** with `MERMAID_CONFIG_PATH` → temp file: env set → env wins; env unset → file value; key absent everywhere → fallback/undefined; malformed file → fallback (no throw); empty-string env → file fallback. Call `_resetConfigCache()` between cases that change the file.

### consult_grok XAI read (setup.ts)
**Change:** `const apiKey = process.env.XAI_API_KEY;` → `const apiKey = getConfig('XAI_API_KEY');` (+ import `getConfig`). The existing `if (!apiKey) throw 'XAI_API_KEY ... not set'` guard stays. Behavior unchanged when env is set; now also works when the key is only in `~/.mermaid-collab/config.json` (the desktop case).
**Test:** covered by config-service tests + tsc; behavior is a one-line source swap.

---

## 3. Task Dependency Graph

### YAML Graph
```yaml
tasks:
  - id: config-service
    files: [src/services/config-service.ts]
    tests: [src/services/__tests__/config-service.test.ts]
    description: "NEW config service: getConfig(key, fallback?) precedence env -> ~/.mermaid-collab/config.json -> fallback; cached safe file load (missing/malformed -> {}); configPath() honors MERMAID_CONFIG_PATH for tests; _resetConfigCache(). bun:test cases: env-wins, file-fallback, absent->fallback, malformed->no-throw, empty-env->file."
    parallel: true
    depends-on: []
  - id: xai-via-config
    files: [src/mcp/setup.ts]
    tests: []
    description: "Route consult_grok's XAI_API_KEY read through getConfig('XAI_API_KEY') (import from ../services/config-service). Keep the existing not-set guard. One-line swap; fixes the desktop XAI bug (server reads key from global config.json regardless of launch)."
    parallel: false
    depends-on: [config-service]
```

### Execution Waves
**Wave 1:** config-service
**Wave 2:** xai-via-config

### Summary
- Total tasks: 2
- Total waves: 2
- Max parallelism: 1
