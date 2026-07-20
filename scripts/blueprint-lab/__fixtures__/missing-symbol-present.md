Blueprint: add a new test covering the existing `parseDuration` behavior, no production symbol
needs to change.

```json
{ "schemaVersion": 2, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/util/__tests__/time.test.ts"],
  "tasks": [
    { "id": "add-parse-duration-test", "files": ["src/util/__tests__/time.test.ts"], "description": "Add coverage for parseDuration" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "named-test", "testFile": "src/util/__tests__/time.test.ts", "testName": "parses ISO 8601 durations", "mechanical": true }
  ],
  "outOfScope": []
}
```
