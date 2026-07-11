# Blueprint: Session Watching — PID-Keyed Redesign

## Source Artifacts
- `research-session-watching-redesign` (sections 1-6, with section 6 as the authoritative design)

## 1. Structure Summary

### Files

- [ ] `scripts/session-start-hook.sh` — rewrite. Keeps PID walking (still needed to find Claude CLI PID on hook side), adds: binding carry-forward on `source=clear|compact`, stale PID-file pruning.
- [ ] `scripts/active-hook.sh` — rewrite. Drops PID walking. Reads `/tmp/.mermaid-collab-binding-<session_id>.json` by stdin `session_id`. POSTs full `{claudeSessionId, project, session, status:"active"}` payload.
- [ ] `scripts/notification-hook.sh` — same as active, `status:"waiting"`.
- [ ] `scripts/permission-hook.sh` — same as active, `status:"permission"`.
- [ ] `src/mcp/setup.ts` — rewrite `register_claude_session` case (~line 2903) and its tool schema (~line 1440). Adds required `claudePid` argument, reads `/tmp/.claude-session-id-<claudePid>` to resolve session_id, writes binding file.
- [ ] `src/routes/api.ts` — delete `claudeSessionMap` (line 58-63), strip `/api/claude-session/register` to broadcast-only (line 2139-2167), rewrite `/api/session-notify` stateless (line 2169-2194).
- [ ] `skills/collab/SKILL.md` — add Bash `echo $PPID` step before every `register_claude_session` call in Steps 3 and 4. Pass result as `claudePid` argument.

### Key types / payloads

**Binding file** `/tmp/.mermaid-collab-binding-<session_id>.json`:
```json
{
  "claudeSessionId": "<uuid>",
  "project": "<abs path>",
  "session": "<collab session name>",
  "claudePid": 18378,
  "boundAt": 1775865833894
}
```

**`/api/session-notify` request** (now stateless — hooks send full payload):
```json
{
  "claudeSessionId": "<uuid>",
  "project": "<abs path>",
  "session": "<collab session name>",
  "status": "active" | "waiting" | "permission"
}
```

**`register_claude_session` args**:
```ts
{ project: string; session: string; claudePid: string | number }
```

### Component interactions

```
Claude CLI (PID P)
   │
   ├── SessionStart hook ──► writes /tmp/.claude-session-id-<P>
   │                         (+ carries forward binding on /clear, /compact)
   │                         (+ prunes stale PID files)
   │
   ├── /collab skill
   │     │
   │     ├─► Bash: echo $PPID       (returns P — verified empirical)
   │     │
   │     └─► register_claude_session(project, session, claudePid=P)
   │           │
   │           ├── reads  /tmp/.claude-session-id-<P>   → session_id
   │           ├── writes /tmp/.mermaid-collab-binding-<session_id>.json
   │           └── POST   /api/claude-session/register  → WS broadcast
   │
   └── PreToolUse / Stop / PermissionRequest hooks
         │
         ├── read stdin.session_id
         ├── read /tmp/.mermaid-collab-binding-<session_id>.json
         └── POST /api/session-notify {claudeSessionId, project, session, status}
              │
              └── server broadcasts claude_session_status over WS
                    │
                    └── UI subscriptionStore.updateStatus()
```

**Deleted:** `claudeSessionMap` in-memory. Server becomes stateless for this feature.

---

## 2. Function Blueprints

### `session-start-hook.sh`

**Pseudocode:**
1. Read stdin JSON; extract `session_id`, `source`.
2. Walk `$PPID` upward via `ps -o command=` matching `(^|/)claude( |$)` to find Claude CLI PID (existing logic — already works).
3. If both present:
   a. Read previous session_id from `/tmp/.claude-session-id-<PID>` if it exists → `OLD_SID`.
   b. Overwrite `/tmp/.claude-session-id-<PID>` with new `SESSION_ID`.
   c. If `source ∈ {clear, compact}` and `OLD_SID` exists and `OLD_SID ≠ SESSION_ID`:
      - If `/tmp/.mermaid-collab-binding-<OLD_SID>.json` exists:
        - `jq --arg sid $SESSION_ID '.claudeSessionId = $sid' OLD > NEW`
        - `rm -f OLD`
4. Cleanup loop: for each `/tmp/.claude-session-id-*`, if PID no longer a live `claude`, remove file.
5. `echo '{"continue": true}'; exit 0`.

**Error handling:** silent (hooks must never block Claude). All failures fall through to `{continue: true}`.
**Edge cases:** first-run (no previous file), empty session_id, non-claude PID, file unwritable.
**Test strategy:** manual — start Claude, `ls /tmp/.claude-session-id-*`; run `/clear`, verify binding file renamed; kill Claude, start another, verify old file pruned on next SessionStart.

---

### `active-hook.sh` / `notification-hook.sh` / `permission-hook.sh`

All three are identical except for the `status` string.

**Pseudocode:**
1. Read stdin JSON; extract `session_id`. If empty, exit with continue.
2. Check `/tmp/.mermaid-collab-binding-<session_id>.json` exists. If not, exit with continue (user hasn't run `/collab` yet — this is normal).
3. Parse binding file: extract `project`, `session`. If either empty, exit with continue.
4. `curl -s -X POST http://localhost:3737/api/session-notify -d '{claudeSessionId, project, session, status}'` in background.
5. `echo '{"continue": true}'; exit 0`.

**Error handling:** silent. Background curl absorbs network errors.
**Edge cases:** missing binding (= not bound yet, normal), server down (background curl fails silently), malformed binding (jq returns empty, hook exits cleanly).
**Test strategy:** with a bound session, trigger a tool call; verify UI dot flips to correct color within 500ms.

---

### `register_claude_session` (src/mcp/setup.ts)

**Signature:**
```ts
case 'register_claude_session': (args: { project: string; session: string; claudePid: string | number }) => string
```

**Pseudocode:**
1. Validate `project`, `session`, `claudePid`. Return `{success:false, error}` on missing.
2. Read `/tmp/.claude-session-id-<claudePid>`. On ENOENT, return `{success:false, error:"restart Claude so SessionStart hook runs"}`.
3. Trim content → `claudeSessionId`. If empty, return error.
4. Write `/tmp/.mermaid-collab-binding-<claudeSessionId>.json` with `{claudeSessionId, project, session, claudePid, boundAt}`.
5. POST `/api/claude-session/register?project=&session=` with `{claudeSessionId}` to trigger initial WS broadcast.
6. Return the server response JSON.

**Also update tool schema (~line 1440):** add `claudePid` as required string; update description to reference the Bash `$PPID` discovery step.

**Error handling:** return structured `{success:false, error}` for missing args, missing PID file, fs write failures.
**Edge cases:** file exists but empty, stale PID file (belongs to a dead Claude — user restarted — would return stale session_id; mitigated because PID files are pruned on each new SessionStart).
**Test strategy:** call from a fresh Claude session via skill; verify binding file exists; verify `describe binding content`.

---

### `/api/session-notify` (src/routes/api.ts)

**Pseudocode:**
1. Parse body: `{claudeSessionId, project, session, status}`.
2. 400 if any missing.
3. `wsHandler.broadcast({type:"claude_session_status", claudeSessionId, project, session, status, lastUpdate: Date.now()})`.
4. Return `{success:true}`.

**No state lookup. No `claudeSessionMap`.**

**Error handling:** standard 400 on missing fields.
**Edge cases:** unknown collab session (broadcast anyway — UI ignores if not subscribed).
**Test strategy:** curl-post a payload, verify WS message in browser devtools.

---

### `/api/claude-session/register` (src/routes/api.ts)

**Pseudocode:**
1. Parse `project`, `session` from query; `claudeSessionId` from body.
2. 400 if any missing.
3. `wsHandler.broadcast({type:"claude_session_registered", claudeSessionId, project, session})`.
4. Return `{success:true, claudeSessionId}`.

**Error handling:** 400 on missing params.
**Edge cases:** none — stateless.
**Test strategy:** covered by `register_claude_session` end-to-end test.

---

### `skills/collab/SKILL.md` update

Add a sub-step after "Create the session" / before "Register this Claude Code session":

```
Before registering, discover this Claude Code CLI's PID by running the Bash
tool with: echo "$PPID"

($PPID inside a Bash tool command is the Claude CLI process, verified
empirically — the tool forks /bin/zsh as a direct child of Claude.)

Then pass it into register_claude_session as the claudePid argument:

Tool: mcp__plugin_mermaid-collab_mermaid__register_claude_session
Args: { "project": "<cwd>", "session": "<name>", "claudePid": "<number>" }
```

Apply to both Step 3 (Create New Session) and Step 4 (Resume Existing Session).

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: hook-session-start
    files: [scripts/session-start-hook.sh]
    tests: []
    description: "Rewrite SessionStart hook: add binding carry-forward on clear/compact, stale PID-file pruning. Keep existing PID walking."
    parallel: true
    depends-on: []

  - id: hook-active
    files: [scripts/active-hook.sh]
    tests: []
    description: "Rewrite active-hook (PreToolUse): drop PID walking, read binding file by stdin session_id, POST full payload with status=active."
    parallel: true
    depends-on: []

  - id: hook-notification
    files: [scripts/notification-hook.sh]
    tests: []
    description: "Rewrite notification-hook (Stop): drop PID walking, read binding file, POST full payload with status=waiting."
    parallel: true
    depends-on: []

  - id: hook-permission
    files: [scripts/permission-hook.sh]
    tests: []
    description: "Rewrite permission-hook (PermissionRequest): drop PID walking, read binding file, POST full payload with status=permission."
    parallel: true
    depends-on: []

  - id: mcp-register
    files: [src/mcp/setup.ts]
    tests: []
    description: "Rewrite register_claude_session tool: require claudePid arg, read /tmp/.claude-session-id-<pid> to resolve session_id, write binding file, POST broadcast. Update tool input schema to add required claudePid."
    parallel: true
    depends-on: []

  - id: server-api
    files: [src/routes/api.ts]
    tests: []
    description: "Delete claudeSessionMap, strip /api/claude-session/register to broadcast-only, rewrite /api/session-notify stateless (accepts full {claudeSessionId, project, session, status} payload and broadcasts)."
    parallel: true
    depends-on: []

  - id: skill-collab
    files: [skills/collab/SKILL.md]
    tests: []
    description: "Add Bash 'echo $PPID' step before register_claude_session in Steps 3 and 4. Pass result as claudePid argument. Update example tool calls."
    parallel: true
    depends-on: []
```

### Execution Waves

**Wave 1 (parallel — all 7 tasks):**
- hook-session-start
- hook-active
- hook-notification
- hook-permission
- mcp-register
- server-api
- skill-collab

All tasks touch different files and have no compile-time dependencies on each other. The runtime contract between them is coordinated via the binding-file JSON shape and the `/api/session-notify` payload shape — both frozen in this blueprint so parallel agents can't drift.

### Summary
- Total tasks: 7
- Total waves: 1
- Max parallelism: 7

### Post-implementation verification (not a task, done manually after Wave 1)
1. Restart Claude Code. Verify `/tmp/.claude-session-id-<PID>` written.
2. Run `/collab` → `register_claude_session`. Verify `/tmp/.mermaid-collab-binding-<uuid>.json` written with correct project/session.
3. Run any tool call. Verify UI dot flips to green.
4. Run `/clear`. Verify binding file renamed to new session_id. Run another tool call. Verify dot stays green.
5. Start a second Claude CLI in the same cwd. Run `/collab` with a different collab session. Verify two distinct binding files and two distinct UI dots.
6. Restart the collab server with bound sessions active. Make a tool call. Verify dot lights up without re-running `/collab`.
