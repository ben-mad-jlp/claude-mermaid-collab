I now have a complete picture of the pattern. Here is the implementation blueprint.

---

## Blueprint: Persist `conductorTargetMissionId` on `watched_project` with get/set accessors

### Goal
Add a per-project nullable TEXT column `conductorTargetMissionId` to the `watched_project` table in `src/services/supervisor-store.ts`, plus `getConductorTargetMissionId` / `setConductorTargetMissionId` accessors. This gives the conductor a persistent, human-settable "drive THIS mission" override slot. This leaf is **storage + accessors only** — no consumer wiring in `conductor-pass.ts`.

### Pattern to follow
Model exactly on the existing **nullable-TEXT** per-project column pattern. The closest analogs are:
- `contextRecycleMode` (TEXT column) — for the DDL/interface/migration shape.
- `getWatchdogThreshold` / `setWatchdogThreshold` (`src/services/supervisor-store.ts:415-428`) — for the **nullable get/set** shape where `set(project, null)` clears the slot and `get` returns `null` when unset. Our value type is `string | null` instead of `number | null`.

All per-project setters are **UPDATE-only** (never `INSERT`/auto-watch) — see the standing invariant tested at `src/services/__tests__/supervisor-store.watchdog.test.ts:31-35` and `52+`.

### Changes

**1. Interface field — `src/services/supervisor-store.ts`, `WatchedProject` interface (after line 33, before the closing `}` at line 34):**
```ts
  /** Per-project autonomous-conductor target mission override (a mission todoId), or null
   *  (== no override; the conductor auto-selects the first actionable mission). */
  conductorTargetMissionId?: string | null;
```

**2. DDL column — `src/services/supervisor-store.ts`, inside `CREATE TABLE IF NOT EXISTS watched_project` (add a line after `gateShadowMode INTEGER` at line 204):**
```sql
  gateShadowMode INTEGER,
  conductorTargetMissionId TEXT
```

**3. Migration — `src/services/supervisor-store.ts`, in the `addColumnIfMissing` block (after line 326):**
```ts
  addColumnIfMissing(db, 'watched_project', 'conductorTargetMissionId', 'conductorTargetMissionId TEXT');
```

**4. Accessors — `src/services/supervisor-store.ts`, add after `setGateShadowMode` (after line 521):**
```ts
/** Per-project AUTONOMOUS CONDUCTOR target-mission override (a mission todoId), or null if unset
 *  (the conductor auto-selects). UPDATE-only (like the other per-project setters — never auto-watch;
 *  a project must be watched first). Pass null to clear the override. */
export function getConductorTargetMissionId(project: string): string | null {
  const d = openDb();
  const row = d.query('SELECT conductorTargetMissionId FROM watched_project WHERE project = ?')
    .get(project) as { conductorTargetMissionId: string | null } | undefined;
  return row?.conductorTargetMissionId ?? null;
}
export function setConductorTargetMissionId(project: string, missionId: string | null): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET conductorTargetMissionId = ? WHERE project = ?')
    .run(missionId, project);
}
```

**5. Tests — `src/services/__tests__/supervisor-store.watchdog.test.ts`:**
Add `getConductorTargetMissionId, setConductorTargetMissionId` to the import from `../supervisor-store` (line 10), and append a new `describe` block modeled on the watchdog block (lines 15-50):
```ts
describe('per-project conductor target mission override', () => {
  it('defaults to null for a freshly watched project', () => {
    addWatchedProject('/proj/ctm-a');
    expect(getConductorTargetMissionId('/proj/ctm-a')).toBeNull();
  });
  it('null for an unknown project', () => {
    expect(getConductorTargetMissionId('/proj/ctm-unknown')).toBeNull();
  });
  it('set then get round-trips', () => {
    addWatchedProject('/proj/ctm-b');
    setConductorTargetMissionId('/proj/ctm-b', 'mission-123');
    expect(getConductorTargetMissionId('/proj/ctm-b')).toBe('mission-123');
  });
  it('setConductorTargetMissionId is UPDATE-only (creates no watched_project row if absent)', () => {
    setConductorTargetMissionId('/proj/ctm-c', 'mission-x');
    expect(getConductorTargetMissionId('/proj/ctm-c')).toBeNull();
    expect(listWatchedProjects().some((p) => p.project === '/proj/ctm-c')).toBe(false);
  });
  it('clearing with null reverts to unset', () => {
    addWatchedProject('/proj/ctm-d');
    setConductorTargetMissionId('/proj/ctm-d', 'mission-y');
    setConductorTargetMissionId('/proj/ctm-d', null);
    expect(getConductorTargetMissionId('/proj/ctm-d')).toBeNull();
  });
});
```

### Notes
- `listWatchedProjects` (line 412) uses `SELECT *` and casts to `WatchedProject[]`, so the new column is automatically exposed on listed rows once the interface field and DDL/migration are in place — no change needed there.
- Value stored is a raw mission todoId string; no format validation in this leaf (matches how other TEXT slots store free-form values).

### Acceptance criteria (positive, citable)
1. `WatchedProject` interface in `src/services/supervisor-store.ts` declares field `conductorTargetMissionId?: string | null;`.
2. The `CREATE TABLE IF NOT EXISTS watched_project` DDL in `src/services/supervisor-store.ts` includes column `conductorTargetMissionId TEXT`.
3. `src/services/supervisor-store.ts` calls `addColumnIfMissing(db, 'watched_project', 'conductorTargetMissionId', 'conductorTargetMissionId TEXT')` in the migration block (backfills existing DBs).
4. `src/services/supervisor-store.ts` exports `getConductorTargetMissionId(project: string): string | null` reading the column and returning `null` when unset.
5. `src/services/supervisor-store.ts` exports `setConductorTargetMissionId(project: string, missionId: string | null): void` performing an UPDATE-only write.
6. `src/services/__tests__/supervisor-store.watchdog.test.ts` contains a passing `describe('per-project conductor target mission override', ...)` block covering default-null, round-trip, UPDATE-only, and clear-with-null.

```json
{ "schemaVersion": 2, "estimatedFiles": 2, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/supervisor-store.ts", "src/services/__tests__/supervisor-store.watchdog.test.ts"],
  "tasks": [
    { "id": "interface-field", "files": ["src/services/supervisor-store.ts"], "description": "Add conductorTargetMissionId?: string | null to WatchedProject interface" },
    { "id": "ddl-and-migration", "files": ["src/services/supervisor-store.ts"], "description": "Add conductorTargetMissionId TEXT to watched_project DDL and addColumnIfMissing migration" },
    { "id": "accessors", "files": ["src/services/supervisor-store.ts"], "description": "Add getConductorTargetMissionId and setConductorTargetMissionId (UPDATE-only, nullable)" },
    { "id": "tests", "files": ["src/services/__tests__/supervisor-store.watchdog.test.ts"], "description": "Add per-project conductor target mission override describe block (default/round-trip/update-only/clear)" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/services/supervisor-store.ts", "symbol": "getConductorTargetMissionId", "description": "Reader accessor returning string | null" },
    { "kind": "symbol-present", "file": "src/services/supervisor-store.ts", "symbol": "setConductorTargetMissionId", "description": "UPDATE-only writer accepting string | null" },
    { "kind": "named-test", "testFile": "src/services/__tests__/supervisor-store.watchdog.test.ts", "testName": "set then get round-trips", "mechanical": true }
  ],
  "outOfScope": [
    "Wiring conductorTargetMissionId into conductor-pass.ts mission selection (separate leaf)",
    "MCP tool / API route / UI surface for setting the override (separate leaf)",
    "Validating that missionId references a real mission"
  ] }
```