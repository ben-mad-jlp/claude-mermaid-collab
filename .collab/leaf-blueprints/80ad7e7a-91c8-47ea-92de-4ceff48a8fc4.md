# Blueprint: Verify-only — confirm `shouldUseFloor` export

**Leaf:** 80ad7e7a-91c8-47ea-92de-4ceff48a8fc4
**Type:** VERIFY-ONLY GATE #2 TEST LEAF (231d10d4)
**Outcome:** No code changes. Confirm an existing export.

## Acceptance

`src/services/leaf-executor.ts` exports a function named `shouldUseFloor`.

## Verification (read-only, already satisfied)

Confirmed present at `src/services/leaf-executor.ts:399`:

```ts
export function shouldUseFloor(m: LeafSizeManifest | null): boolean {
  if (!m) return true; // unparseable ⇒ FLOOR (fail-safe)
  return (
    m.estimatedFiles <= FILE_THRESHOLD &&
    m.estimatedTasks <= TASK_THRESHOLD &&
    !m.nonEnumerableFanout
  );
}
```

- Line 399: `export function shouldUseFloor(...)` — present and exported.
- Used internally at line 787 (`if (!shouldUseFloor(manifest))`) and documented in the JSDoc at lines 347 and 760.

Command to re-verify:

```bash
grep -n 'export function shouldUseFloor' src/services/leaf-executor.ts
```

Expected: one match at line ~399.

## Changes

**NONE.** This work is already done. Make no edits, create no files.

```json
{ "schemaVersion": 1, "estimatedFiles": 0, "estimatedTasks": 0,
  "nonEnumerableFanout": false,
  "filesToCreate": [], "filesToEdit": [],
  "tasks": [] }
```
