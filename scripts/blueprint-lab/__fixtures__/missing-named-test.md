Blueprint: add a `formatDuration(ms: number): string` helper to `src/util/time.ts`; existing
test coverage already exercises this code path indirectly.

```json
{ "schemaVersion": 2, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/util/time.ts"],
  "tasks": [
    { "id": "add-format-duration", "files": ["src/util/time.ts"], "description": "Add formatDuration helper" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/util/time.ts", "symbol": "formatDuration", "description": "New exported duration formatter" }
  ],
  "outOfScope": []
}
```
