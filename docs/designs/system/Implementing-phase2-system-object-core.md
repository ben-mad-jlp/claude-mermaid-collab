# Blueprint: Phase 2 — Durable System-Object Core (type registry + store + Todo.objectRef + cad/saas plugins + BOM)

Decomposition of epic `c88efd59` per design-system-object-primitive §3/§4/§8. Phase 1 (gate-runner + runCadGate wired + core-purity test, todo `9f258ae3`) is DONE/accepted — `gate-runner.ts`, `cad-gate-runner.ts`, `core-purity.test.ts` are in-tree. Phase 2 is greenfield (none of the target files exist yet).

## Source Artifacts
- design-system-object-primitive (§2 architecture, §3 schema, §4 firewall, §7 mechanics, §8 technical plan)
- design-B-orthogonal-trees, research-system-object-model (context)

## Guiding invariants
- **Two stores, one firewall.** Durable facts (type/composition/revision) live in a NEW `.collab/system-objects.db`; the work-graph (`todos`) links via ONE nullable `Todo.objectRef`. A durable object has NO status/claim/lease columns — the lease-IFF-in_progress firewall, by construction.
- **Core stays domain-agnostic.** No domain literal ("cad"/"saas"/"robot"/…) may appear in core source — enforced by the existing `core-purity.test.ts` (extend its globbed file set to cover the new core files).
- **Reuse, don't rewrite.** Clone the `todo-store.ts` bun:sqlite pattern (openDb, addColumnIfMissing, withLock). Mirror `resolveProfile` for the plugin merge. Closed `ArtifactType` enum is NEVER edited — overlay it.

## 1. Structure Summary

### Files (created unless noted)
- `src/services/domain-plugin.ts` — interfaces: `DomainPlugin`, `GatePlugin` (re-export/align with gate-runner's), `ArtifactKind`, `SystemObjectType`, `SystemObject`, `SystemRevision`. Pure types, no runtime deps.
- `src/services/system-object-store.ts` — `system-objects.db` (bun:sqlite): `types`/`instances`/`revisions` tables, CRUD, content-hash revisions, `withLock`/`addColumnIfMissing` cloned from todo-store.
- `src/services/system-object-bom.ts` (or a section of the store) — recursive BOM CTE (qty multiplies down) + where-used (walk up). Never stored.
- `src/services/plugin-registry.ts` — global⟵org⟵project merge (mirrors `resolveProfile`), narrowing-only enforcement; `validateChild(parentType, childType)` composition-grammar check.
- `src/services/artifact-kind-resolver.ts` — overlay map `domain:kind` → base `ArtifactType` + ext + folder (closed enum untouched; fail-closed on unknown kind).
- `src/plugins/cad/index.ts`, `src/plugins/saas/index.ts` — seed `DomainPlugin`s (cad registers `runCadGate` as plugin #1 + `cad:step`; saas registers the subprocess `gateCommand` adapter + `saas:openapi`/`saas:storybook`).
- `src/services/todo-store.ts` — EXTEND: `+objectRef` nullable column via `addColumnIfMissing` (one-directional FK; NO lifecycle columns — the firewall).
- Tests alongside each (`*.test.ts`, bun:sqlite ones excluded from vitest like todo-store.test.ts).

### Key types (from §3)
- `SystemObjectType { id, version, domain, attributeSchema, allowedChildTypes[], requiredArtifacts[], gateBinding|null, agentProfile|null }`
- `SystemObject { id, typeId, typeVersion(PINNED), parentObjectId|null, qty, name, attributes, currentRevisionId|null }` — no status/claim/lease.
- `SystemRevision { id, objectId, contentHash, createdAt, gateVerdict }` — contentHash over `{attributes, sorted child refs+qty, attached artifact hashes}`.
- `DomainPlugin { domain, types[], artifactKinds[], gates[], views? }`; `ArtifactKind { kind, baseType, ext, folder }`.

## 2. Function Blueprints (non-trivial)

### `system-object-store`: createObject / addChild / newRevision
- `createObject(type, name, attrs, parent?)`: resolve+validate `attrs` against `type.attributeSchema`; if parent, `validateChild(parentType, type)` MUST pass; pin `typeVersion = type.version`; insert; return object. Edge cases: unknown typeId → throw; grammar violation → throw (no insert).
- `newRevision(objectId)`: compute `contentHash` over a CANONICAL serialization (attributes + children sorted by id with qty + sorted attached artifact hashes); if a revision with that hash exists → reuse (idempotent); else insert with `gateVerdict='unknown'`. Test: identical content ⇒ identical hash ⇒ no new row.

### BOM recursive CTE
- `bom(rootId)`: `WITH RECURSIVE` over `instances` joining `parentObjectId`, `qty` multiplying down; group by typeId → totals. `whereUsed(objId)`: same walk upward. Test against the §5 Robot example (Motor:6, Encoder:6, Gearbox:6, Sensor:2).

### `plugin-registry`: merge + validateChild
- `resolvePlugins(project)`: global base ⟵ org ⟵ `.collab/project.json plugins[]`; a project may only NARROW `allowedChildTypes`/`requiredArtifacts` (subset) — widening throws. Mirrors `resolveProfile`. 
- `validateChild(parentType, childType)`: pure; `childType ∈ parentType.allowedChildTypes` (post-narrowing). No grammar → reject.

### `artifact-kind-resolver`
- `resolveArtifactKind("cad:step")` → `{ baseType, ext, folder }` from the overlay; unknown kind → fail-closed (throw / null per open-Q #2 — choose fail-closed). Closed enum at artifact-api.ts:18 untouched.

## 3. Task Dependency Graph

```yaml
tasks:
  - id: domain-plugin-types
    files: [src/services/domain-plugin.ts]
    tests: [src/services/__tests__/domain-plugin.test.ts]
    description: "Core interfaces — DomainPlugin/GatePlugin/ArtifactKind/SystemObjectType/SystemObject/SystemRevision. Pure types; align GatePlugin with gate-runner.ts. No domain literals (core-purity)."
    parallel: true
    depends-on: []
  - id: system-object-store
    files: [src/services/system-object-store.ts]
    tests: [src/services/__tests__/system-object-store.test.ts]
    description: ".collab/system-objects.db (bun:sqlite cloned from todo-store): types/instances/revisions tables + CRUD; content-hash newRevision with reuse; createObject pins typeVersion + validates attributeSchema. NO status/claim/lease columns."
    parallel: false
    depends-on: [domain-plugin-types]
  - id: system-object-bom
    files: [src/services/system-object-bom.ts]
    tests: [src/services/__tests__/system-object-bom.test.ts]
    description: "Recursive BOM CTE (qty multiplies down) + where-used (walk up) over the store. Derived, never stored. Verify against the Robot worked example."
    parallel: false
    depends-on: [system-object-store]
  - id: plugin-registry
    files: [src/services/plugin-registry.ts]
    tests: [src/services/__tests__/plugin-registry.test.ts]
    description: "global<-org<-project plugin merge mirroring resolveProfile (narrowing-only; widening throws) + pure validateChild composition-grammar check."
    parallel: true
    depends-on: [domain-plugin-types]
  - id: artifact-kind-resolver
    files: [src/services/artifact-kind-resolver.ts]
    tests: [src/services/__tests__/artifact-kind-resolver.test.ts]
    description: "Overlay domain:kind -> base ArtifactType+ext+folder; closed ArtifactType enum (artifact-api.ts) untouched; fail-closed on unknown kind."
    parallel: true
    depends-on: [domain-plugin-types]
  - id: todo-objectref-and-seed-plugins
    files: [src/services/todo-store.ts, src/plugins/cad/index.ts, src/plugins/saas/index.ts]
    tests: [src/services/__tests__/todo-store.test.ts, src/services/__tests__/seed-plugins.test.ts]
    description: "todo-store +objectRef nullable column via addColumnIfMissing (one-directional FK, NO lifecycle columns). Seed cad plugin (runCadGate as #1 + cad:step) and saas plugin (gateCommand adapter + saas:openapi/storybook) registering via plugin-registry + artifact-kind-resolver + gate-runner."
    parallel: false
    depends-on: [system-object-store, plugin-registry, artifact-kind-resolver]
```

### Execution Waves
- **Wave 1:** `domain-plugin-types` (no deps)
- **Wave 2 (after types):** `system-object-store`, `plugin-registry`, `artifact-kind-resolver` (parallel)
- **Wave 3:** `system-object-bom` (after store), `todo-objectref-and-seed-plugins` (after store + registry + resolver)

### Summary
- Total tasks: 6 · Waves: 3 · Max parallelism: 3
- Each task is an independently-gateable change-set (tsc + its own tests). The seam to the work-graph is the single `Todo.objectRef` column; the firewall (no lifecycle on durable objects) is the acceptance bar for `system-object-store`.
