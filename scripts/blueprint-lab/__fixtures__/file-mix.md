Blueprint: add a `formatDuration` helper to `src/util/time.ts` and a `parseDuration` helper to
`src/util/parse.ts`, with a new test file `src/util/__tests__/time.test.ts`.

```json
{ "schemaVersion": 2, "estimatedFiles": 3, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/util/__tests__/time.test.ts"],
  "filesToEdit": ["src/util/time.ts", "src/util/parse.ts"],
  "tasks": [
    { "id": "add-format-duration", "files": ["src/util/time.ts"], "description": "Add formatDuration helper" },
    { "id": "add-parse-duration", "files": ["src/util/parse.ts"], "description": "Add parseDuration helper" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/util/time.ts", "symbol": "formatDuration", "description": "New exported duration formatter" },
    { "kind": "symbol-present", "file": "src/util/parse.ts", "symbol": "parseDuration", "description": "New exported duration parser" },
    { "kind": "named-test", "testFile": "src/util/__tests__/time.test.ts", "testName": "formats sub-second durations as ms", "mechanical": true }
  ],
  "outOfScope": []
}
```
