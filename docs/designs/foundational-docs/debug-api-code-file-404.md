# Debug: `/api/code/file` returns 404 `"Not found"`

## Symptom

```
curl 'http://127.0.0.1:9002/api/code/file?project=%2Fsrv%2Fcodebase%2Fqbs&path=...'
→ HTTP 404 {"error":"Not found"}
```

Meanwhile the sibling endpoint `/api/code/files` (list) returns 200 and works correctly for the same `project`.

## Root Cause

**The running Bun server process is stale relative to the source code.** It was started BEFORE the commit that added the `/file` route, so the in-memory module has no `/file` handler and every request falls through to the catch-all at `src/routes/code-api.ts:126` which emits `{"error":"Not found"}`.

### Evidence

| Fact | Value |
|---|---|
| `src/routes/code-api.ts` mtime | `2026-04-21 08:33:14` |
| Commit `4707486` ("feat(server): GET /api/code/file endpoint") date | `2026-04-21 08:33:54` |
| Running process (owner of :9002) | PID `2788269`, `bun run src/server.ts` |
| Process start time (`ps -o lstart`) | `Tue Apr 21 06:54:57 2026` |
| Delta | Process started **~1h 38m before** the `/file` route was added |

`ss -ltnp` confirms PID 2788269 owns `:9002`. Bun imports modules once at startup, so the later edit to `code-api.ts` never made it into memory. The "server was restarted" claim does not match reality for this PID — whatever was restarted did not restart this Bun process.

### Why the body is literally `"Not found"`

At `src/routes/code-api.ts:32-132`, `handleCodeAPI` dispatches:

- `/files` GET → `handleListProjectFiles` (works — present in the old build)
- `/file` GET → `handleReadCodeFile` (added by 4707486 — **not in the running build**)
- …fallthrough → `return jsonError('Not found', 404)` at line 126

Had execution reached `handleReadCodeFile`, the possible errors would be `"project must be an absolute path"`, `"Unknown project: ..."`, `"File not found"`, `"Path escapes project root"`, etc. — never the bare `"Not found"`. That string is a fingerprint of the dispatch-fallthrough, confirming the route never matches.

The suspicion in the task brief (fallthrough at line 126 firing because `/file` isn't matching) was correct. The reason it isn't matching is **not** a prefix-strip bug, method mismatch, or body-vs-query issue in the code on disk — the code on disk is correct. It's purely that the code on disk is newer than the code in memory.

## Affected Files / Lines

- `src/routes/code-api.ts:54-60` — the `/file` route handler (correct on disk, missing in memory)
- `src/routes/code-api.ts:126` — the fallthrough currently returning the 404
- `src/server.ts:150-152` — dispatcher forwarding `/api/code/*` to `handleCodeAPI` (fine)

## Proposed Fix

Restart the actual Bun process that owns `:9002` so it reloads `src/routes/code-api.ts` with the `/file` route:

```bash
kill 2788269      # or the current PID from: ss -ltnp | grep :9002
# then restart however this deployment starts it, e.g.:
bun run src/server.ts
# or:
npm run dev
```

After restart, verify the process start time post-dates the file mtime:

```bash
ps -o lstart= -p "$(ss -ltnp 'sport = :9002' | awk -F'pid=' '/pid=/{print $2}' | cut -d, -f1)"
stat -c '%y' src/routes/code-api.ts
```

Then re-run the failing curl — it should return a JSON body with `kind: "text" | "image" | "binary"` (or `"File not found"` / `"Unknown project: ..."` if inputs are wrong, but never the bare `"Not found"`).

**No code change is required.** The source is already correct as of commit `4707486`.

## Secondary Observation (not the cause, but worth noting)

`handleReadCodeFile` (line 358) does `if (!(await isKnownProject(projectRoot)))` and returns `"Unknown project: ..."`. If after the restart you get that error for `/srv/codebase/qbs`, the project needs to be registered via `register_project` or whatever the app's registration flow is — but that would produce a different error body, not `"Not found"`.
