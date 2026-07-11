# Blueprint: Log a one-line info when forwardIntegrateEpic advances an epic branch

## Goal

Emit a single observability log line inside `forwardIntegrateEpic` in
`src/agent/worktree-manager.ts` when a real forward-merge happens (i.e. when
the method is about to return `{ advanced: true }`). No behaviour change — pure
additive logging.

---

## File to edit

**`src/agent/worktree-manager.ts`**

### Context

`forwardIntegrateEpic` (line 974) merges `trunk` into the epic accumulation
branch with `--no-ff`. At line 1037 it returns
`{ integrated: true, advanced: true, conflict: false }` — this is the only
`advanced: true` return path. All variables needed for a useful message are
in scope at that point:

| Variable | Source | Value example |
|---|---|---|
| `epicId` | parameter | `"ee56b9b6-88d5-42cd-9ead-c756e55aa9a2"` |
| `this.epicId8(epicId)` | private helper (line 699) | `"ee56b9b6"` |
| `trunk` | `resolveBase(baseRef)` result (line 983) | `"master"` |
| `trunkSha` | `rev-parse` result (line 999) | `"a1a81108..."` |
| `onProgress` | `opts?.onProgress` (line 981) | callback or undefined |

### Exact change

**Location:** between the closing brace of the `if (mergeRes.code !== 0)` block
(line 1036) and the final `return` (line 1037).

Insert one statement:

```ts
(onProgress ?? ((_, m) => console.info(m)))('stdout',
  `[forward-integrate] epic ${this.epicId8(epicId)} advanced to ${trunkSha.slice(0, 8)} (${trunk})`);
```

**Before (lines 1036–1037):**
```ts
      return { integrated: false, advanced: false, conflict: true, conflictedPaths };
    }
    return { integrated: true, advanced: true, conflict: false };
  }
```

**After:**
```ts
      return { integrated: false, advanced: false, conflict: true, conflictedPaths };
    }
    (onProgress ?? ((_, m) => console.info(m)))('stdout',
      `[forward-integrate] epic ${this.epicId8(epicId)} advanced to ${trunkSha.slice(0, 8)} (${trunk})`);
    return { integrated: true, advanced: true, conflict: false };
  }
```

### Why this shape

- `onProgress` is already captured at line 981; callers that pass it (leaf-executor
  line 1811) will see the line routed through their progress stream to the daemon log.
- Callers that omit `onProgress` (tests, direct callers) get `console.info` fallback
  — never silently dropped.
- `trunkSha.slice(0, 8)` gives a readable short SHA without an extra git call.
- No imports needed — all symbols are already in scope.

---

## Size manifest

```json
{
  "schemaVersion": 1,
  "estimatedFiles": 1,
  "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/agent/worktree-manager.ts"],
  "tasks": [
    {
      "id": "add-forward-integrate-log",
      "files": ["src/agent/worktree-manager.ts"],
      "description": "Insert one onProgress/console.info log line before the advanced:true return in forwardIntegrateEpic"
    }
  ]
}
```
