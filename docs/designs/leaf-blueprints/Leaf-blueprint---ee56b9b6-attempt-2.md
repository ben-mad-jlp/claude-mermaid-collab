# Blueprint: Log a one-line info when forwardIntegrateEpic advances an epic branch

## Goal

Add a single observability log line inside `WorktreeManager.forwardIntegrateEpic` in
`src/agent/worktree-manager.ts` so the daemon log records when a stale epic base was
auto-refreshed. No behaviour change; purely additive.

## File to edit

**`src/agent/worktree-manager.ts`**

### Location

`forwardIntegrateEpic` method (~line 974). The successful-merge path returns at the
bottom of the method. The log line must be inserted immediately **after** the
`merge --abort` / conflict-return block closes (i.e. after the `return { integrated:
false, advanced: false, conflict: true, conflictedPaths }` line) and **before** the
final `return { integrated: true, advanced: true, conflict: false }`.

### Exact change

Insert after line ~1036 (`return { integrated: false, advanced: false, conflict: true,
conflictedPaths };`):

```ts
(onProgress ?? ((_, m) => console.info(m)))('stdout',
  `[forward-integrate] epic ${this.epicId8(epicId)} advanced to ${trunkSha.slice(0, 8)} (${trunk})`);
```

This expression:
- Uses `onProgress` if provided (routes into the leaf's streaming progress channel,
  which appears in daemon logs).
- Falls back to `console.info` with a no-op first-arg discard `(_, m) => console.info(m)`
  so it still surfaces when there is no progress callback.
- Logs enough context: the short epic id (via `this.epicId8(epicId)`), the short trunk
  SHA (`trunkSha.slice(0, 8)`), and the base ref name (`trunk`).

### Symbols referenced

| Symbol | Where defined |
|---|---|
| `onProgress` | destructured from `opts` at line ~981 |
| `this.epicId8(epicId)` | helper method on `WorktreeManager` — returns `epicId.slice(0,8)` |
| `trunkSha` | resolved at line ~999 via `rev-parse` |
| `trunk` | resolved via `this.resolveBase(baseRef)` at line ~983 |

### Nothing else to touch

- No new imports.
- No interface changes (`ForwardIntegrateResult` unchanged).
- No test changes required (the happy-path test at line ~86 already asserts
  `res.advanced === true`; the log line is a side-effect, not a return-value change).

## Risk

Negligible. The `??` fallback ensures the expression never throws. The log fires only
on the `advanced:true` path, which is already tested.

```json
{ "schemaVersion": 1, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/agent/worktree-manager.ts"],
  "tasks": [
    {
      "id": "add-forward-integrate-log",
      "files": ["src/agent/worktree-manager.ts"],
      "description": "Insert one onProgress/console.info line after successful merge in forwardIntegrateEpic"
    }
  ] }
```
