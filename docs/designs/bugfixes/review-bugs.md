# Bug Review

Review target: uncommitted working-tree changes across session-start-hook.sh, active-hook.sh, notification-hook.sh, permission-hook.sh, src/mcp/setup.ts, src/routes/api.ts, skills/collab/SKILL.md.

Scope: correctness only (not design compliance).

---

## Important

### 1. `/api/session-notify` no longer validates `status` enum, broadcasts arbitrary strings to WS clients
- **File:** `src/routes/api.ts` lines 2156-2177
- **What:** The old implementation constrained status via `claudeSessionMap` and a controlled set; the new handler type-annotates `status?: 'active' | 'waiting' | 'permission'` but does NO runtime check. Any value (including HTML/script payloads, arbitrary strings) is accepted and broadcast verbatim over WebSocket to every connected UI client under `type: 'claude_session_status'`.
- **Why it matters:** Anything listening on `localhost:3737` can POST to `/api/session-notify` and inject arbitrary `project`, `session`, and `status` strings into the WS stream. If the UI renders any of these as HTML or uses them to route filesystem/tool actions, this is an XSS / cross-session confusion vector. Previously the server at minimum rejected unknown `claudeSessionId`s.
- **Fix:** Validate `status` is one of the three allowed literals and reject otherwise. Consider also re-introducing a server-side registry check so only previously-registered claudeSessionIds can emit status events, or at minimum require a shared token.

```ts
const ALLOWED_STATUS = new Set(['active', 'waiting', 'permission']);
if (!claudeSessionId || !project || !session || !status || !ALLOWED_STATUS.has(status)) {
  return Response.json({ error: '...' }, { status: 400 });
}
```

### 2. `/api/session-notify` dropped the registry check — removes trust boundary
- **File:** `src/routes/api.ts` lines 2156-2177
- **What:** Previously `claudeSessionMap.get(claudeSessionId)` gated the broadcast, so only sessions that had first called `/api/claude-session/register` could emit status. That map is now removed entirely. Any process can fabricate a fresh `claudeSessionId` + `project` + `session` triple and spam the WS channel.
- **Why it matters:** This was the only integrity check coupling `claudeSessionId` to a real registration. Its removal means a buggy/malicious local caller can now impersonate arbitrary sessions in the UI and even broadcast events for sessions the user never created.
- **Fix:** Either re-introduce an in-memory registry populated by `/api/claude-session/register` and reject unknown sessionIds in `session-notify`, or have `session-notify` validate the triple against the on-disk binding file at `/tmp/.mermaid-collab-binding-${claudeSessionId}.json`.

### 3. `register_claude_session` does not validate `claudePid` is numeric — path traversal via tool arg
- **File:** `src/mcp/setup.ts` lines 2905-2914
- **What:** `claudePid` is accepted as `string | number`, coerced via `String(claudePid).trim()`, and then interpolated into a file path: `` `/tmp/.claude-session-id-${pidStr}` ``. There is no check that it matches `^[0-9]+$`. A caller passing `claudePid: "../etc/passwd"` would cause `readFileSync('/tmp/.claude-session-id-../etc/passwd', ...)` = `/etc/passwd`, and the contents would then be used as `claudeSessionId` and written further into another path (see bug 4).
- **Why it matters:** The tool is exposed via MCP and the arg comes from the model's tool_use output. If the model is tricked (prompt injection) into passing a malicious PID, the server reads attacker-controlled file paths.
- **Fix:**
```ts
if (!/^[0-9]+$/.test(pidStr)) {
  return JSON.stringify({ success: false, error: 'claudePid must be a positive integer' });
}
```

### 4. `register_claude_session` does not validate `claudeSessionId` read from file before using it as filename
- **File:** `src/mcp/setup.ts` lines 2917-2941
- **What:** The contents of `/tmp/.claude-session-id-<pid>` are trimmed and then interpolated directly into `` `/tmp/.mermaid-collab-binding-${claudeSessionId}.json` `` for `writeFileSync`. If the session-id file has been tampered with (attacker with same-user write access, stale file from a prior buggy run, or the ppid traversal in bug 3), the binding could be written to an arbitrary filesystem path like `/tmp/.mermaid-collab-binding-../../home/user/.ssh/authorized_keys.json`.
- **Why it matters:** Defense in depth. Even if we consider the session-id file "trusted", it's plain text in `/tmp` and very easy for any process running as the same user to overwrite. A simple format check prevents the MCP from helping an attacker escalate file writes.
- **Fix:** Validate against UUID format after reading:
```ts
if (!/^[0-9a-fA-F-]{8,64}$/.test(claudeSessionId)) {
  return JSON.stringify({ success: false, error: 'Invalid claudeSessionId in pid file' });
}
```
Also sanity-check length and reject any `/`, `..`, `\0`.

### 5. Hook scripts do not validate `SESSION_ID` format before using it in file paths
- **Files:**
  - `scripts/active-hook.sh` line 15: `BINDING_FILE="/tmp/.mermaid-collab-binding-${SESSION_ID}.json"`
  - `scripts/notification-hook.sh` line 15: same
  - `scripts/permission-hook.sh` line 16: same
  - `scripts/session-start-hook.sh` lines 38-39: `OLD_BINDING`/`NEW_BINDING` built from `OLD_SID` and `SESSION_ID`
- **What:** `SESSION_ID` (and `OLD_SID`) come from JSON parsed by `jq`, then interpolated into filesystem paths with no format check. `jq -r` returns the raw string value, so if Claude Code ever hands the hook a `session_id` containing `../..`, the path escapes `/tmp`. Also affects the session-start-hook carry-forward where both `OLD_SID` and `SESSION_ID` are used to build paths and then passed to `rm -f`.
- **Why it matters:** Same defensive concern as #4. Claude session IDs are UUIDs in practice, but nothing in the scripts enforces that; a single CLI bug or format change could turn this into arbitrary file read/write/delete under the user's account.
- **Fix:** After reading SESSION_ID, validate with e.g.:
```sh
case "$SESSION_ID" in
  ''|*[!0-9a-fA-F-]*) echo '{"continue": true}'; exit 0 ;;
esac
```
and the same for `OLD_SID` in `session-start-hook.sh`.

### 6. `session-start-hook.sh` cleanup loop can touch other users' files on shared `/tmp`
- **File:** `scripts/session-start-hook.sh` lines 52-66
- **What:** `for f in /tmp/.claude-session-id-*` iterates across ALL users' session-id files on shared `/tmp` (standard on Linux, also macOS when multiple accounts are active). For each, it runs `ps -o command= -p "$stale_pid"`; if the PID is not a claude process (which it won't be if it's owned by another user and filtered by `ps`, or if ps can't see it), the script executes `rm -f "$f"`. On most Unix systems, `rm` on another user's file in `/tmp` will fail due to the sticky bit, so the damage is bounded — but:
  - If `/tmp` does not have the sticky bit (misconfigured systems, some containers), files owned by other users would be deleted silently.
  - On macOS the hook's view of `ps` is system-wide, but `ps -o command= -p <other-user-pid>` normally still returns the command, so other users' live claude instances wouldn't be pruned. However on Linux with `hidepid=2` mounted `/proc`, `ps` returns nothing for other users, so the cleanup branch will fire and attempt `rm -f` on every foreign session-id file in `/tmp` — again sticky-bit-bounded but generating noise and racing.
  - Concurrency: two Claude instances running the cleanup simultaneously may both decide to delete a file that a third, newly started instance is about to write. This is a race.
- **Why it matters:** On correctly-configured systems the worst case is benign noise, but on mis-configured or containerized environments this can delete another user's live session state.
- **Fix:**
  1. Skip files not owned by the current user: `[ "$(stat -f %u "$f" 2>/dev/null || stat -c %u "$f" 2>/dev/null)" = "$(id -u)" ] || continue` before any `rm`.
  2. Before deleting, re-check the PID is not equal to `CLAUDE_PID` of the current hook (avoid deleting your own file during a race).
  3. Consider moving per-user state under `${TMPDIR:-/tmp}/claude-mermaid-collab-$(id -u)/` to side-step the shared-`/tmp` issue entirely.

---

## Minor

### 7. `session-start-hook.sh` carry-forward leaves orphaned binding on `jq` failure
- **File:** `scripts/session-start-hook.sh` lines 40-46
- **What:** On `jq` failure the `else` branch does `rm -f "$NEW_BINDING"` but leaves `OLD_BINDING` intact — OK for rollback. However the new session is now unbound and the very next notification hook for the new session id will hit `BINDING_FILE not found` and silently drop the event. There is no error logging to help diagnose.
- **Fix:** Log to a debug file (same style as the existing `/tmp/.claude-active-hook-debug`).

### 8. Binding files accumulate indefinitely
- **Files:** `scripts/session-start-hook.sh`, `src/mcp/setup.ts`
- **What:** `/tmp/.mermaid-collab-binding-<uuid>.json` files are created on each `register_claude_session` and carried forward on clear/compact, but never deleted when a Claude session truly ends (no SessionEnd hook, no age-based cleanup). Over long-lived shells these files pile up.
- **Fix:** Extend the cleanup loop at the bottom of `session-start-hook.sh` to also prune `/tmp/.mermaid-collab-binding-*.json` files older than N days, or add a SessionEnd hook.

### 9. `echo "$INPUT" > /tmp/.claude-active-hook-debug` is shared across all Claude instances
- **Files:** `scripts/active-hook.sh` line 9, `scripts/notification-hook.sh` line 9, `scripts/permission-hook.sh` line 10
- **What:** The debug files are single fixed paths. Multiple concurrent Claude instances will clobber each other's debug snapshots, making post-mortem harder. Also a minor cross-user `/tmp` clobber risk (sticky bit mitigates the security side).
- **Fix:** Either include `$CLAUDE_PID`/`$SESSION_ID` in the path, or drop the debug dump in production hooks.

### 10. `echo "$INPUT" | jq ...` can misinterpret input starting with `-`
- **Files:** all four hooks (`session-start-hook.sh` line 7-8, `active-hook.sh` line 7, etc.)
- **What:** `echo` with certain shells/builtins treats a leading `-e`/`-n`/`-E` as a flag and strips it. If Claude ever prefixes the JSON payload with such, the first bytes would be eaten. Unlikely with JSON (always starts with `{`), but `printf '%s\n' "$INPUT" | jq ...` is the portable form.
- **Fix:** Prefer `printf '%s' "$INPUT" | jq ...`.

### 11. `register_claude_session` swallows fetch errors
- **File:** `src/mcp/setup.ts` lines 2943-2949
- **What:** The final `fetch(buildUrl('/api/claude-session/register', ...))` has no try/catch. If the collab server is down, the error bubbles up and the MCP response is an uncaught exception — after the binding file has already been written. The on-disk state says "registered" but the server never saw it.
- **Fix:** Wrap in try/catch and return `{ success: false, error }` with enough detail for the model to report the failure. Consider best-effort deleting the binding file on failure (or leaving it so the next operation can retry against the server).

### 12. `register_claude_session` — `response.json()` called even on non-2xx
- **File:** `src/mcp/setup.ts` line 2948
- **What:** `const data = await response.json()` is called unconditionally. If the server returns HTML or an empty body on error, `.json()` throws and the real HTTP status is hidden from the caller.
- **Fix:** Check `response.ok` first and return a structured error including `response.status` and `await response.text()` on failure.

### 13. `OLD_SID=$(cat "$SID_FILE" 2>/dev/null | tr -d '[:space:]')`
- **File:** `scripts/session-start-hook.sh` line 29
- **What:** Using `tr -d '[:space:]'` silently collapses any whitespace. If the file ever contained two concatenated session IDs (e.g., due to a race where two writes happened between file-open and file-write), `OLD_SID` would be a mashup that matches neither session. Not a new bug (pre-existing behavior), but the carry-forward logic amplifies it: a bogus `OLD_SID` will point at a nonexistent `OLD_BINDING` and silently no-op the carry-forward.
- **Fix:** Read with `head -n1 "$SID_FILE"` and trim only trailing newline: `OLD_SID=$(head -n1 "$SID_FILE" 2>/dev/null | tr -d '\r\n ')`.

### 14. Race between write and cleanup in `session-start-hook.sh`
- **File:** `scripts/session-start-hook.sh` lines 33 and 52-66
- **What:** The hook writes `SID_FILE` at line 33, then at lines 52-66 iterates ALL session-id files and may re-check the current PID. In the cleanup pass, if `ps` transiently returns empty for the still-live claude (very rare on macOS, possible under heavy load), the hook would delete the file it just wrote moments before. The window is tiny but present.
- **Fix:** Skip `$SID_FILE` explicitly in the cleanup loop: `[ "$f" = "$SID_FILE" ] && continue`.

---

## Not bugs / verified OK

- **jq `--arg` usage in active/notification/permission hooks:** properly escapes; no injection via payload contents.
- **Background `curl` in hooks:** correctly detached with `&` and `>/dev/null 2>&1`; no PID leak.
- **`[ -e "$f" ] || continue` nullglob guard** in cleanup loop: correct, handles the empty-glob case.
- **Grouping of `SOURCE` compare:** `{ [ ... ] || [ ... ]; } && [ ... ] && [ ... ]` — braces & spacing correct, no precedence bug.
- **`exit 0` restored in notification-hook.sh:** previously missing, now present at end of file.
- **String coercion of `claudePid` in setup.ts:** `String(claudePid).trim()` handles both `number` and `string` inputs cleanly (modulo the missing numeric validation in bug 3).

---

## Summary

- Critical: 0
- Important: 6 (bugs 1-6)
- Minor: 8 (bugs 7-14)

The headline issues are (a) the `/api/session-notify` endpoint losing its trust boundary and status-enum validation, and (b) the absence of format validation on `claudePid`, `claudeSessionId`, and hook `SESSION_ID` before using them in filesystem paths. Both classes are defense-in-depth gaps that the previous code handled implicitly via the in-memory `claudeSessionMap` and the PPID-derived (non-user-supplied) PID.

---

## Second pass (post-fix)

All 14 first-pass findings were re-verified against the current working tree. **All 14 fixes are correct and in place.** Five new low/minor issues were identified, none of them regressions and none that undo the security gains of the first pass. Portability-critical bits (`${#VAR}`, `case` patterns, `find -maxdepth 0 -mtime +7`, `stat -f %u`/`stat -c %u`) were verified to work on both macOS (BSD userland, bash 3.2) and Linux (GNU userland, bash 4+).

### Fix verification — all green

| # | Bug | Status | Evidence |
|---|---|---|---|
| 1 | status enum not validated | FIXED | `api.ts` 2164-2167 `ALLOWED_STATUS` set + membership check |
| 2 | session-notify trust boundary lost | FIXED | `api.ts` 2174-2185 reads `/tmp/.mermaid-collab-binding-${claudeSessionId}.json`, rejects on mismatch (403) or absence (404) |
| 3 | `claudePid` not numeric-validated | FIXED | `setup.ts` 2910 `/^[0-9]+$/` guard |
| 4 | `claudeSessionId` post-read not validated | FIXED | `setup.ts` 2927 `/^[0-9a-fA-F-]{8,64}$/` guard |
| 5 | hooks don't validate `SESSION_ID` | FIXED | All four hooks: `case "$SESSION_ID" in ''\|*[!0-9a-fA-F-]*)` + length 8..64 via `${#SESSION_ID}` |
| 6 | cleanup touches other users' files | FIXED (with NB-1 caveat) | `session-start-hook.sh` 86-89, 107-109 uses `file_owner()` against `CURRENT_UID` |
| 7 | orphan binding on jq failure unlogged | FIXED | `session-start-hook.sh` 65 writes to `$DEBUG_LOG` |
| 8 | binding files never GC'd | FIXED | `session-start-hook.sh` 105-115 GC loop with `-mtime +7` |
| 9 | shared debug file clobber | FIXED | Each hook writes `/tmp/.claude-<name>-hook-debug-${SESSION_ID}` |
| 10 | `echo` can eat leading `-` | FIXED | All hooks use `printf '%s' "$INPUT" | jq ...` |
| 11 | fetch errors swallowed | FIXED | `setup.ts` 2946-2960 wraps fetch in try/catch |
| 12 | `response.json()` on non-2xx | FIXED | `setup.ts` 2952-2955 checks `response.ok` first |
| 13 | `cat | tr '[:space:]'` collapse | FIXED | `session-start-hook.sh` 41 uses `head -n1 | tr -d '\r\n '` |
| 14 | self-delete race in cleanup | FIXED | `session-start-hook.sh` 84 `[ "$f" = "$SID_FILE" ] && continue` |

### Portability verification

- **`${#SESSION_ID}`** — POSIX parameter expansion, supported by bash 3.2 (macOS default) and bash 4+ (Linux). Works on unset vars (returns 0) so `set -u` would not trip it either. OK.
- **`case "$SESSION_ID" in ''|*[!0-9a-fA-F-]*)`** — POSIX bracket expression with negation. Works identically on macOS `/bin/bash` and Linux `/bin/bash`. OK.
- **`find "$b" -maxdepth 0 -mtime +7 2>/dev/null | grep -q .`** — `-maxdepth` is a non-POSIX extension supported by both BSD find (macOS) and GNU find (Linux). `-maxdepth 0` restricts processing to the path argument itself (no directory walk). `-mtime +7` selects files whose mtime is strictly older than 7 * 24h, supported on both. `grep -q .` succeeds iff any output is produced. Correctly detects files older than 7 days on both platforms. OK.
- **`stat -f %u` / `stat -c %u` fallback in `file_owner()`** — BSD stat uses `-f`, GNU stat uses `-c`; the `||` chain tries BSD first (succeeds on macOS) and GNU second (succeeds on Linux). Both print numeric UID for `%u`. OK.
- **`setup.ts` catch block referencing `bindingFile`** — `bindingFile` is in scope and the file was successfully written before the `try` that performs the fetch (write is in its own try/catch at 2931-2945, and the function returns early if that write fails). The "Binding file was still written at ${bindingFile}" message is therefore accurate. OK.
- **Invalid-SID path exit flow** — when `sid_valid=0` the hooks `echo '{"continue": true}'; exit 0` without ever touching `$BINDING_FILE`, and the `session-start-hook.sh` wraps its entire PID/binding block in `if [ "$sid_valid" = "1" ]` so neither `$SID_FILE` nor `$OLD_BINDING`/`$NEW_BINDING` is built from an untrusted value. The final cleanup loops still run (which is desirable — we still want to prune stale files). OK.

### New issues found in the post-fix code

#### NB-1 (Minor) — `file_owner()` fall-open: stat failure lets cleanup proceed
- **File:** `scripts/session-start-hook.sh` lines 76-89 and 107-109
- **What:** `file_owner()` returns an empty string when both `stat -f %u` and `stat -c %u` fail. The caller then uses:
  ```sh
  owner=$(file_owner "$f")
  [ -n "$owner" ] && [ "$owner" != "$CURRENT_UID" ] && continue
  ```
  The `[ -n "$owner" ]` short-circuits to false when stat fails, so the `continue` is **not** executed and the loop proceeds to consider `$f` for deletion. This is fail-open: if we cannot determine ownership, we treat the file as ours.
- **Why it matters:** On a sticky-bit `/tmp` the damage is still bounded (the `rm -f` on a foreign file will fail silently), but on sticky-bit-less or bind-mounted `/tmp` this re-opens the cross-user deletion window that bug 6 was meant to close. Also, if both stat binaries are missing on some stripped-down container image, every iteration falls through to `rm -f`.
- **Fix:** Treat "unknown owner" as "not ours" and skip:
  ```sh
  owner=$(file_owner "$f")
  if [ -z "$owner" ] || [ "$owner" != "$CURRENT_UID" ]; then
    continue
  fi
  ```
  Apply the same change to the binding-file GC loop (lines 107-109).

#### NB-2 (Minor) — Synchronous `readFileSync` in the async `/api/session-notify` handler
- **File:** `src/routes/api.ts` line 2178
- **What:** The new trust-boundary check uses `readFileSync(bindingPath, 'utf-8')` inside an `async` route handler. This blocks the event loop for every PreToolUse, Stop, and permission event — a hot path fired many times per Claude turn.
- **Why it matters:** Not a correctness bug, but a latency / throughput regression versus the old in-memory `Map.get()`. Under load the blocking I/O serializes the event loop and can interact badly with other concurrent WS broadcasts.
- **Fix:** Switch to `await fs.promises.readFile(bindingPath, 'utf-8')` (import as `readFile` from `fs/promises`) and keep the same try/catch shape. Zero behavioral change, non-blocking.

#### NB-3 (Minor) — `/api/session-notify` conflates "binding missing" and "binding corrupt"
- **File:** `src/routes/api.ts` lines 2176-2185
- **What:** The single `catch {}` around `readFileSync` + `JSON.parse` returns `404 Unknown session (no binding)` for **both** ENOENT and JSON parse errors. A truncated / corrupted binding file will look to callers (and operators reading logs) like the session was never registered.
- **Why it matters:** Low-severity correctness issue — hides a real failure mode. If the writer in `setup.ts` is ever interrupted mid-write (see NB-4), the reader silently blames the client instead of reporting a 5xx.
- **Fix:** Inspect the caught error and branch:
  ```ts
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return Response.json({ error: 'Unknown session (no binding)' }, { status: 404 });
    }
    return Response.json({ error: `Binding read failed: ${err?.message || String(err)}` }, { status: 500 });
  }
  ```

#### NB-4 (Minor) — Non-atomic binding write permits short TOCTOU window
- **File:** `src/mcp/setup.ts` lines 2931-2945
- **What:** `fs.writeFileSync(bindingFile, ...)` is not atomic. If a hook's HTTP request races with a concurrent re-registration (e.g., two MCP clients both calling `register_claude_session` for the same session — unlikely but not impossible after a clear+reregister), the reader can observe a truncated prefix of the previous file and hit `JSON.parse` failure — which, combined with NB-3, returns a misleading 404. Also relevant to the session-start-hook's carry-forward, which already uses the rename-after-jq pattern for the same reason.
- **Fix:** Write to `${bindingFile}.tmp-${process.pid}` then `fs.renameSync` onto the final path for atomic replace. Matches the pattern used in the shell hook.

#### NB-5 (Minor / defense-in-depth) — SID regex permits pathologically weak values
- **Files:** `src/mcp/setup.ts` line 2927, `src/routes/api.ts` line 2170, all four hook scripts
- **What:** `/^[0-9a-fA-F-]{8,64}$/` (and the equivalent shell `case` pattern) allows strings like `--------` or `aaaaaaaa` that are 8..64 chars of [hex|dash]. Since the regex forbids `/`, `.`, `..`, and `\0`, no path-traversal is possible, so this is **not** a security hole. But it's semantically much looser than a real Claude session id (which is a v4 UUID).
- **Fix (optional):** Tighten to the UUID shape for both the TS regex and the hooks' `case` pattern. Shell version (POSIX):
  ```sh
  case "$SESSION_ID" in
    [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) sid_valid=1 ;;
    *) sid_valid=0 ;;
  esac
  ```

#### NB-6 (Info only, not a bug) — `$PPID`-from-Bash-tool claim in SKILL.md is fragile
- **File:** `skills/collab/SKILL.md` step 4 (Start), parallel block in Step 4 (Resume)
- **What:** The skill tells the model to run `echo $PPID` inside the Bash tool and pass the result as `claudePid`, claiming "verified empirically, since the tool forks /bin/zsh as a direct child of Claude." This is currently true for Claude Code's implementation, but it couples the skill to an undocumented harness detail. If Claude Code ever routes Bash through an intermediary (e.g., a sandbox helper, a remote worker, or a wrapped shim), `$PPID` would no longer equal the process that the `session-start-hook` registered under, and `register_claude_session` would reliably fail with `No Claude session ID file at /tmp/.claude-session-id-<pid>`.
- **Why it's not a correctness bug today:** The regex + ENOENT handling gives a clean error, so nothing misbehaves silently — it just stops working until the skill is updated.
- **Suggested hardening (follow-up, not blocking):** Have `register_claude_session` itself walk the process tree looking for a file that exists (`/tmp/.claude-session-id-*` whose pid is an ancestor of `process.pid`), identical to what the session-start-hook already does. This removes the model-in-the-loop PID discovery and makes the tool robust against harness changes.

### Residual first-pass issues

None. Every bug in the first-pass review (1 through 14) has a matching code change that correctly addresses it. NB-1 is a partial regression of the fix for bug 6 (the new `file_owner` function fails open on stat errors); it does not undo the main improvement (per-user UID comparison under sticky `/tmp`) but should be tightened.

### Second-pass summary

- First-pass fixes verified: **14 / 14**
- New bugs introduced: **0 critical, 0 important, 5 minor (NB-1..NB-5), 1 info (NB-6)**
- Portability on macOS bash 3.2 and Linux bash 4+: **verified**
- `setup.ts` catch block referencing `bindingFile`: **verified correct** (file is written before the fetch `try`, so the message is accurate)
- `case` + `${#SESSION_ID}` rejection of invalid ids under `set -u` semantics: **safe** (scripts don't set `-u`, and both constructs are unset-safe anyway)
