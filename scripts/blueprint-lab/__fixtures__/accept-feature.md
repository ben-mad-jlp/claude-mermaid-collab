Blueprint: add a `formatDuration(ms: number): string` helper to `src/util/time.ts`, covered by a
new test `formats sub-second durations as ms` in `src/util/__tests__/time.test.ts`.

```json
{ "schemaVersion": 2, "estimatedFiles": 2, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/util/time.ts", "src/util/__tests__/time.test.ts"],
  "tasks": [
    { "id": "add-format-duration", "files": ["src/util/time.ts"], "description": "Add formatDuration helper" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/util/time.ts", "symbol": "formatDuration", "description": "New exported duration formatter" },
    { "kind": "named-test", "testFile": "src/util/__tests__/time.test.ts", "testName": "formats sub-second durations as ms", "mechanical": true }
  ],
  "outOfScope": []
}
```
