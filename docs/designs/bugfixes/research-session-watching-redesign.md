# Session Watching: Root Cause and Redesign

## 1. Confirmed root cause

**The MCP server is HTTP-only, not stdio. `process.ppid` inside `register_claude_session` is never Claude's PID, so the entire PID-walking correlation scheme cannot work on any platform — Mac or Linux.**

### Evidence

1. **MCP transport**: `src/server.ts:107-108` routes `/mcp` to `handleMCPRequest`, which uses `StreamableHttpTransport` (`src/mcp/http-handler.ts:13`). The plugin's `.claude-plugin/plugin.json` declares **only `hooks` — no `mcpServers` entry**. Claude Code reaches the MCP server by HTTP (via its ambient MCP config pointing at `http://localhost:3737/mcp`), it does NOT spawn a child process. Therefore, the MCP server process tree is:

   ```
   concurrently (39600) → bun run src/server.ts (39601)
   ```

   `process.ppid` inside a tool handler is `39600` (concurrently/shell), forever. It has no parent-chain path to Claude's PID.

2. **Running processes confirm the tree.** `ps -eo pid,ppid,command` shows the only claude process is PID `18378` with parent `854` (tmux/shell), and the server (`39601`) is a child of `concurrently`. They share no ancestors.

3. **`register_claude_session` implementation** (`src/mcp/setup.ts:2907`) literally does `fs.readFileSync(\`/tmp/.claude-session-id-${process.ppid}\`)`. With `process.ppid` = 39600 (or similar), the file `/tmp/.claude-session-id-39600` **does not exist and never will**. That is exactly the error the user observed: *"No Claude session ID found. Restart Claude Code to initialize the session hook."*

4. **SessionStart hook actually did work correctly.** `/tmp/.claude-session-id-18378` exists and contains the current session id. The PID-walk in `session-start-hook.sh` matches `(^|/)claude( |$)` against ps output, which finds the real `claude` process fine on this Mac. So the SessionStart hook isn't the broken piece — the lookup in the MCP tool is.

5. **The other hooks (`active-hook.sh`, `permission-hook.sh`, `notification-hook.sh`) successfully find the Claude PID** via the same ps walk — the debug files at `/tmp/.claude-{active,permission,notification}-hook-debug` contain correct `session_id`, `cwd`, `hook_event_name`, and more. Their POSTs to `/api/session-notify` are arriving at the server; they're simply being silently dropped because `claudeSessionMap` has never been populated (register_claude_session could never run).

6. **Secondary bug (latent even if #1 were fixed)**: when the user runs `/clear` or the session auto-compacts, Claude Code assigns a **new** `session_id` while keeping the **same PID**. The current SessionStart hook overwrites `/tmp/.claude-session-id-<PID>`, but any previously-registered `claudeSessionMap` entry for the OLD session id is orphaned, and the new session id is not auto-re-registered. The user has to manually call `/collab` again. This is a design flaw even in the happy path.

7. **Tertiary fragility**: `claudeSessionMap` is an in-memory `Map` on the server — every server restart wipes all bindings. Users have to re-run `/collab` in every open Claude Code window after a restart.

### What the user suspected vs what actually broke

- The user's hypothesis that "Stop/Permission/PreToolUse hooks don't know about the claude session id" is **not** how those hooks actually fail — they DO receive `session_id` on stdin (confirmed in debug files and in the docs). The breakage is on the `register_claude_session` side: it can't identify which (project, session) a given `session_id` is bound to, because it can't even read its own Claude session id.
- The `(^|/)claude( |$)` regex is fine on Mac — `ps -o command=` prints just `claude` (no leading path). The regex matches.
- So the PID-walking strategy in the hooks works. The PID-walking strategy in the MCP tool is structurally impossible under HTTP transport.

---

## 2. Claude Code hook primitives (authoritative, from docs)

Source: https://code.claude.com/docs/en/hooks

### Fields every hook receives on stdin

Every hook event receives at minimum:

- `session_id` — **guaranteed, on every hook event**
- `transcript_path` — absolute path to the per-session JSONL transcript, e.g. `~/.claude/projects/<slug>/<session_id>.jsonl`
- `cwd` — current working directory of the Claude process
- `hook_event_name` — e.g. `"SessionStart"`, `"PreToolUse"`, `"Stop"`, `"PermissionRequest"`
- `permission_mode` — e.g. `"acceptEdits"`, `"default"`

### Event-specific fields relevant to session watching

| Event | Extra fields |
|---|---|
| `SessionStart` | `source` (`"startup"` \| `"resume"` \| `"clear"` \| `"compact"`), `model` |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id`, optional `agent_id`, `agent_type` |
| `PermissionRequest` | `tool_name`, `tool_input`, `permission_suggestions[]`, optional `agent_id` |
| `Stop` | `stop_hook_active`, `last_assistant_message` |
| `Notification` | `message`, `title`, `notification_type` (`"permission_prompt"` \| `"idle_prompt"` \| ...) |
| `SessionEnd` | none beyond common |
| `CwdChanged` | updated `cwd` |

### Environment variables set for hook commands

- `$CLAUDE_PROJECT_DIR` — project root (great for deriving the "project" key on every hook call)
- `$CLAUDE_PLUGIN_ROOT` — the plugin installation directory
- `$CLAUDE_PLUGIN_DATA` — **per-plugin persistent data directory** (ideal for our mapping file)
- `$CLAUDE_ENV_FILE` — only on `SessionStart`, `CwdChanged`, `FileChanged`; a path to a file you can append KEY=VALUE to, which the harness will then export into subsequent Bash tool invocations. (Irrelevant for session watching, but worth knowing.)
- `$CLAUDE_CODE_REMOTE` — `"true"` when running in a remote/web environment

### Important negative findings

- **There is NO `CLAUDE_SESSION_ID` environment variable.** The session id is only available on stdin. So a "just read `process.env.CLAUDE_SESSION_ID` in the MCP server" approach is not viable.
- **Env vars written to `CLAUDE_ENV_FILE` only flow into Bash tool invocations**, not into the MCP server process. So we can't use it to export state back into the MCP tool handler.
- The MCP server, reached over HTTP, receives **no session-identifying headers from Claude Code** other than its own `Mcp-Session-Id` (which is scoped to the MCP transport layer, not Claude's session id).

---

## 3. Alternative designs

### Design A — Persistent file-based mapping written by hooks *(recommended)*

**Concept.** Eliminate `process.ppid` correlation entirely. The hooks become the source of truth:

1. `SessionStart` hook writes a keyed mapping file as soon as it fires. Since it doesn't yet know which collab (project, session) the user wants, it writes only `{ session_id, cwd, pid, transcript_path, updated_at }` to a "known sessions" pool.
2. `register_claude_session` (invoked when the user runs `/collab`) no longer tries to use `process.ppid`. Instead, it accepts `cwd` (or derives it from the known-sessions pool) and looks up the most recently started Claude session for that `cwd` — or better, the caller explicitly passes the session id discovered via a companion `Bash` one-liner in the skill prompt (see "handshake" variant below).
3. Once bound, `register_claude_session` writes a second file: `binding-<claude_session_id>.json` containing `{ project, session, claudeSessionId, boundAt }`.
4. Every other hook (`PreToolUse`, `Stop`, `PermissionRequest`, `Notification`) reads `binding-<session_id>.json` from stdin's `session_id` (NO PID walking), POSTs `{ claudeSessionId, project, session, status }` to `/api/session-notify`. The server becomes stateless for this feature: no more in-memory `claudeSessionMap`.

**Storage location.** `$CLAUDE_PLUGIN_DATA/sessions/` (or fall back to `$HOME/.mermaid-collab/sessions/` if `CLAUDE_PLUGIN_DATA` isn't set in older Claude Code versions). Not `/tmp` — survives reboots within the same Claude run, and the plugin data dir is the documented persistent location.

**Handshake variant for the "which session_id should I register?" problem.** Instead of heuristics, make the `/collab` skill flow explicit:

- `register_claude_session` no longer reads `/tmp/.claude-session-id-*` via ppid.
- The collab skill prompt includes a one-line `Bash` call: `jq -r '.session_id' <<< "$CLAUDE_SESSION_INPUT"` — but since that env var doesn't exist, we instead use a different trick: the `SessionStart` hook writes a small token (random UUID) to `$CLAUDE_PLUGIN_DATA/current-session.json` containing `{ session_id, cwd, pid }` and keyed by `cwd`. The MCP tool reads the file keyed by its caller's `cwd`. But the MCP server doesn't know the caller's cwd either — because HTTP MCP has no per-caller context.
- **Better handshake**: add a `claudeSessionId` argument to `register_claude_session`. The `/collab` slash command skill is prompted to run an inline Bash command that reads `$CLAUDE_PLUGIN_DATA/current-session.json` (or, if that file is keyed by cwd, reads the entry for `$PWD`), extracts `session_id`, and passes it into the MCP tool call. Claude itself does the lookup via the Bash tool — trivially robust.

**Pros**
- Zero PID walking in the MCP server. Cross-platform.
- Survives server restarts (bindings are on disk).
- Handles `/clear` and `/compact` naturally: `SessionStart` with `source="clear"` rewrites `current-session.json` with the new session_id, and the *next* `/collab` call rebinds. Even better, the hook can detect `source="clear"|"compact"` and if a previous binding existed for the PID's cwd, carry it over to the new session_id automatically.
- Multiple concurrent Claude instances per project work: the file is keyed by `session_id`, which is globally unique.
- Server becomes simpler — can delete `claudeSessionMap` entirely.

**Cons**
- Requires reading the binding file on every `PreToolUse` (~potentially many). File IO on hot path. Mitigation: `PreToolUse` hook already does a `curl` POST in the background, so one small JSON read is fine.
- Hook scripts become longer (need `jq` to parse and write JSON). They already depend on `jq`, so this is acceptable.

---

### Design B — Make the Claude-side MCP server a periodic heartbeater

**Concept.** Since the MCP server is HTTP and shared, and can't correlate callers to Claude PIDs, flip the model: **hooks** carry all the correlation information on every call.

1. Drop `register_claude_session` and `claudeSessionMap` altogether.
2. Hooks POST not just `{ status }` but `{ session_id, cwd, status }` on every event.
3. The server maintains a `cwd → { session_id, status, lastUpdate }` map purely from hook traffic.
4. The UI subscription panel shows status for any (project, session) pair whose `project` equals a known Claude `cwd`. Status dot shows "active" if that cwd has had a `PreToolUse` within the last N seconds, "waiting" if the most recent signal was `Stop`, etc.
5. `/collab` just subscribes the UI to the (project, session) pair; no explicit binding step.

**Pros**
- No binding step at all. `/collab` doesn't need `register_claude_session`.
- Hooks are the single source of truth. Deleting the registration path simplifies everything.

**Cons**
- Ambiguity when one user runs multiple Claude sessions in the same cwd (two terminals both cd'd to the same project). Status is conflated.
- `session_id` changes on `/clear`, and the UI was binding by (project, collab-session) not by claude-session, so this is actually fine — but the "active" indicator could flicker between the two underlying claude sessions in the multi-window case.
- Less precise — you lose the explicit "this collab session is bound to THIS Claude process" semantic that supports features like future-per-session prompting or targeted notifications.

---

### Design C — Transcript-path as the stable identifier, watched by the server

**Concept.** Each Claude session has a unique `transcript_path` (in `~/.claude/projects/<slug>/<session_id>.jsonl`). It's stable for the life of the session and gets rewritten on `/clear`. Use the file itself as the sync point:

1. `register_claude_session` takes `transcript_path` (or discovers it via `$HOME/.claude/projects/<sluggified-cwd>/*.jsonl` newest-mtime). The MCP tool can easily scan that dir server-side because the server runs on the same machine.
2. Server watches `transcript_path` with `fs.watch`. File grows → `active`. File idle for N seconds → `waiting`. The server infers status from transcript activity without needing hook POSTs at all for `active`/`waiting`.
3. `PermissionRequest` still needs a hook POST because permission prompts don't produce transcript writes the same way — use a single lightweight hook that POSTs only for permissions.

**Pros**
- Eliminates 3 of 4 hooks. Minimal moving parts.
- Extremely robust — transcripts are a documented file format Claude Code relies on for resume/compact, so they're always present.
- Server can retroactively infer "Claude was active 3 seconds ago" when the UI reconnects.

**Cons**
- fs.watch behavior on macOS is notoriously flaky for fast-growing files; you may need polling (`mtime` every 500 ms).
- Distinguishing "active but just thinking" from "waiting on user" via transcript alone is imprecise — thinking tokens vs. no-op idle look similar.
- Couples to an undocumented transcript schema. If Anthropic changes the JSONL format, the watcher may break. (The path itself is documented; the contents are less so.)
- Does not help for permission status (still need a hook).

---

### Design D — Handshake via $CLAUDE_ENV_FILE on SessionStart

**Concept.** Use `SessionStart`'s `CLAUDE_ENV_FILE` to export `CLAUDE_SESSION_ID=<id>` into subsequent Bash tool invocations. Then the `/collab` skill prompt instructs Claude to call `Bash: echo $CLAUDE_SESSION_ID` immediately before calling `register_claude_session`, passing the value as an argument.

**Pros**
- Uses only documented primitives. No ps walking anywhere.
- Simple.

**Cons**
- Still requires the user's skill flow to know to pass the id.
- `CLAUDE_ENV_FILE` only flows into Bash tool calls, not into the MCP handler directly — so the MCP handler still cannot auto-read the session id.
- Effectively a subset of Design A's "handshake variant."

---

### Design E — Unix domain socket per-Claude process

**Concept.** `SessionStart` hook starts a tiny long-lived `netcat`-style daemon bound to `/tmp/claude-<session_id>.sock` (or better, has the main server accept a registration over that socket). MCP server cross-correlates with the open-sockets list.

**Pros**: unique per Claude.
**Cons**: massively overengineered for this problem, adds daemon lifecycle issues, still doesn't solve "which socket corresponds to this MCP caller."

**Rejected** — mentioned for completeness.

---

## 4. Recommendation

**Adopt Design A with the explicit handshake variant.** It is the smallest viable change set, eliminates PID walking entirely in both the MCP server and (optionally) the hooks themselves, survives server restarts, handles `/clear`/`/compact` gracefully, and depends only on documented Claude Code hook primitives (`session_id`, `cwd`, `$CLAUDE_PLUGIN_DATA`).

### Concrete changes

All paths absolute.

#### 1. `/Users/benmaderazo/Code/claude-mermaid-collab/scripts/session-start-hook.sh`

Replace PID walking with a cwd-keyed mapping write.

```bash
#!/bin/bash
# SessionStart hook: record the current Claude session id keyed by cwd.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
SOURCE=$(echo "$INPUT" | jq -r '.source // empty')

if [ -n "$SESSION_ID" ] && [ -n "$CWD" ]; then
  DATA_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.mermaid-collab}"
  mkdir -p "$DATA_DIR/sessions"

  # Write a cwd-keyed pointer (hash the cwd for filesystem safety)
  CWD_HASH=$(printf '%s' "$CWD" | shasum | cut -c1-16)
  printf '{"session_id":"%s","cwd":"%s","source":"%s","updated_at":%s}\n' \
    "$SESSION_ID" "$CWD" "$SOURCE" "$(date +%s)" \
    > "$DATA_DIR/sessions/by-cwd-$CWD_HASH.json"

  # On clear/compact: if an existing binding exists for the OLD session id for
  # this cwd, carry it over to the new session id so the UI dot stays bound.
  if [ "$SOURCE" = "clear" ] || [ "$SOURCE" = "compact" ]; then
    PREV=$(cat "$DATA_DIR/sessions/prev-$CWD_HASH.json" 2>/dev/null)
    if [ -n "$PREV" ]; then
      OLD_ID=$(echo "$PREV" | jq -r '.session_id // empty')
      if [ -n "$OLD_ID" ] && [ -f "$DATA_DIR/sessions/binding-$OLD_ID.json" ]; then
        cp "$DATA_DIR/sessions/binding-$OLD_ID.json" \
           "$DATA_DIR/sessions/binding-$SESSION_ID.json"
      fi
    fi
  fi
  # Remember this session id as "prev" so the NEXT clear/compact can find it.
  printf '{"session_id":"%s"}\n' "$SESSION_ID" > "$DATA_DIR/sessions/prev-$CWD_HASH.json"
fi

echo '{"continue": true}'
exit 0
```

#### 2. `/Users/benmaderazo/Code/claude-mermaid-collab/scripts/active-hook.sh`, `permission-hook.sh`, `notification-hook.sh`

Delete PID walking. Read the binding file by `session_id`, POST with the bound project/session included.

```bash
#!/bin/bash
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && { echo '{"continue": true}'; exit 0; }

DATA_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.mermaid-collab}"
BINDING="$DATA_DIR/sessions/binding-$SESSION_ID.json"
[ ! -f "$BINDING" ] && { echo '{"continue": true}'; exit 0; }

PROJECT=$(jq -r '.project // empty' < "$BINDING")
COLLAB_SESSION=$(jq -r '.session // empty' < "$BINDING")
[ -z "$PROJECT" ] && { echo '{"continue": true}'; exit 0; }

curl -s -X POST http://localhost:3737/api/session-notify \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg sid "$SESSION_ID" --arg p "$PROJECT" --arg s "$COLLAB_SESSION" --arg st "active" \
        '{claudeSessionId:$sid, project:$p, session:$s, status:$st}')" \
  > /dev/null 2>&1 &

echo '{"continue": true}'
exit 0
```

(Change `"active"` to `"waiting"` in `notification-hook.sh`, `"permission"` in `permission-hook.sh`.)

#### 3. `/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts:2903-2921` — rewrite `register_claude_session`

```ts
case 'register_claude_session': {
  const { project, session, claudeSessionId, cwd } = args as {
    project: string; session: string; claudeSessionId?: string; cwd?: string;
  };
  if (!project || !session) throw new Error('Missing required: project, session');

  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const crypto = await import('crypto');

  const dataDir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.mermaid-collab');
  const sessionsDir = path.join(dataDir, 'sessions');

  // Resolve claudeSessionId. Prefer the argument; otherwise look up by cwd.
  let resolvedId = claudeSessionId;
  if (!resolvedId && cwd) {
    const cwdHash = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
    try {
      const pointer = JSON.parse(
        fs.readFileSync(path.join(sessionsDir, `by-cwd-${cwdHash}.json`), 'utf-8')
      );
      resolvedId = pointer.session_id;
    } catch {}
  }
  if (!resolvedId) {
    return JSON.stringify({
      success: false,
      error: 'Could not resolve Claude session id. Pass claudeSessionId or cwd, or restart Claude Code.',
    });
  }

  // Write the binding file so every subsequent hook can find project+session.
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, `binding-${resolvedId}.json`),
    JSON.stringify({ claudeSessionId: resolvedId, project, session, boundAt: Date.now() })
  );

  // Tell the server so the UI lights up immediately (no longer the source of truth —
  // just a broadcast trigger).
  const response = await fetch(buildUrl('/api/claude-session/register', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claudeSessionId: resolvedId }),
  });
  return JSON.stringify(await response.json(), null, 2);
}
```

Also add `claudeSessionId` and `cwd` to the tool's input schema as optional strings.

#### 4. Update the `/collab` skill prompt to pass the session id

The skill should instruct Claude to call `register_claude_session` with `cwd` (using `$PWD`) — or, even simpler, with `claudeSessionId` read from the pointer file via a one-line Bash tool call. The latter is the "explicit handshake" and removes all ambiguity.

#### 5. `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/api.ts:2139-2194`

- Keep `/api/claude-session/register` but demote `claudeSessionMap` to a **broadcast-only** cache (it doesn't need to be the source of truth any more; just use it so the UI gets a `claude_session_registered` ws message for the initial green dot).
- Change `/api/session-notify` to accept `{ claudeSessionId, project, session, status }` **directly from the hook** and broadcast without looking anything up in `claudeSessionMap`. The map becomes optional — delete it if nothing else needs it.

```ts
if (path === '/api/session-notify' && req.method === 'POST') {
  const { claudeSessionId, project, session, status } = await req.json() as {
    claudeSessionId?: string; project?: string; session?: string; status?: string;
  };
  if (!claudeSessionId || !project || !session || !status) {
    return Response.json({ error: 'claudeSessionId, project, session, status required' }, { status: 400 });
  }
  wsHandler.broadcast({
    type: 'claude_session_status',
    claudeSessionId, project, session, status,
    lastUpdate: Date.now(),
  });
  return Response.json({ success: true });
}
```

#### 6. UI (`ui/src/App.tsx:793`, `ui/src/stores/subscriptionStore.ts:63`)

No change needed. The existing `updateStatus(claudeSessionId, status, project, session)` already takes all 4 fields and is keyed by `${project}:${session}`. It already survives server restarts from the UI's perspective (subscriptions are in localStorage). The only thing it currently depends on the server for is the initial `claude_session_registered` broadcast, which we keep.

#### 7. Delete

- `/tmp/.claude-session-id-*` — no longer used.
- The PID-walk loops in all four hook scripts.
- `claudeSessionMap` Map in `src/routes/api.ts:58` (optional).

### Why this meets all the requirements

| Requirement | How Design A satisfies it |
|---|---|
| Cross-platform, no `ps`/PID walking | Eliminated entirely. |
| Survives server restart | Bindings are on disk in `$CLAUDE_PLUGIN_DATA/sessions/`. |
| Handles multiple concurrent Claude instances | Bindings keyed by `session_id`, which is globally unique. |
| Minimizes code changes | ~60 lines changed in 5 files. No UI changes. |
| No undocumented Claude Code behavior | Only uses `session_id` + `cwd` + `$CLAUDE_PLUGIN_DATA`, all documented. |
| Handles `/clear` and `/compact` | SessionStart hook detects `source="clear"|"compact"` and forwards the previous binding to the new session id. |

---

## 5. Open questions

1. **`CLAUDE_PLUGIN_DATA` availability.** The docs list it but do not say which Claude Code version introduced it. Worth verifying empirically by `echo "$CLAUDE_PLUGIN_DATA" > /tmp/plugin-data-test` in the SessionStart hook and checking. The fallback to `$HOME/.mermaid-collab/` is safe either way.
2. **Permission mode for "permission" dot.** Should the "permission" dot come from `PermissionRequest` (which is a hook), from `Notification` with `notification_type="permission_prompt"`, or from both? Today it's `PermissionRequest` only. Worth confirming with a manual test that `PermissionRequest` actually fires when the model asks the user for approval (vs. fires only for rule-evaluation callouts).
3. **Skill flow ergonomics.** Should `register_claude_session` accept `cwd` and auto-resolve from the cwd pointer (less magic for Claude to do), or should the skill prompt be updated to teach Claude to read the pointer file via Bash and pass `claudeSessionId` explicitly? Both work; the cwd-auto-resolve path is simpler to document.
4. **Do we want to *also* rebind the collab UI automatically on `/clear` or `/compact`?** The SessionStart hook can copy forward the binding (as above) so the dot stays green without user action. But if the user expects `/clear` to reset the collab link, this is a behavior change that should be agreed on before shipping.
5. **Unknown: whether the hotfix should also clean up stale `/tmp/.claude-session-id-*` files** (there are currently 5 on this machine, some from April 9). Harmless but noisy.

---

## 6. Option 2 validation — PID-keyed design

This section revisits the design after the cwd-keyed approach in Design A was rejected. Concern with cwd-keying: if two Claude Code instances are launched from the same project directory, both `SessionStart` hooks race to write the same `by-cwd-<hash>.json` file — the second clobbers the first, and the first Claude's `/collab` will bind to the wrong session id. Keying everything by the Claude CLI process PID sidesteps this because every Claude process has a unique PID for the lifetime of the OS boot.

The linchpin question: can the `/collab` skill discover its own Claude CLI PID via the Bash tool? Verified empirically below.

### 6.1 Bash tool PID chain (empirical)

Command executed from this investigation (inside a subagent's Bash tool call):

```
echo "pid=$, ppid=$PPID"; ps -o pid,ppid,command -p $ -p $PPID
```

Output:

```
pid=43068, ppid=18378
  PID  PPID COMMAND
43068 18378 /bin/zsh -c source .../snapshot-zsh-...sh 2>/dev/null || true && ... && eval 'echo "pid=$, ppid=$PPID"; ps -o pid,ppid,command -p $ -p $PPID 2>&1' < /dev/null && pwd -P >| /tmp/claude-140b-cwd
18378   854 claude
```

Independent walk confirming:

```
ps -o pid,ppid,command -p 18378 -p 854
  PID  PPID COMMAND
  854   827 -zsh
18378   854 claude
```

And the matching SessionStart hook output on disk:

```
ls -la /tmp/.claude-session-id-*
...  /tmp/.claude-session-id-18378
cat /tmp/.claude-session-id-18378
b50a4da9-4ba2-472c-89a4-a54075520fa4
```

**Findings**:

1. Each Bash tool call invokes `/bin/zsh -c ...` as a **direct child of the Claude CLI process** — there is no intermediate persistent shell between the tool and the CLI. Every Bash invocation forks a new shell whose PPID is Claude.
2. Therefore, from inside any Bash tool command, `$PPID` **is already the Claude CLI PID** — no walking, no `ps -o ppid= -p $` indirection needed.
3. This holds for subagents too: the investigation ran in a `general-purpose` subagent and still saw `$PPID = 18378` (the single Claude CLI). Subagents are logical contexts within one CLI process, not separate processes.
4. `$PPID` exactly matches the PID in the filename of the existing working SessionStart hook output (`/tmp/.claude-session-id-18378`). So the PID that `/collab` discovers via Bash will always match the one the SessionStart hook already keyed its file with — no translation layer needed.

**The exact shell expression the `/collab` skill should run via Bash:**

```bash
cat "/tmp/.claude-session-id-$PPID"
```

One line. No `ps`, no loops, no `jq`. The value printed is the Claude session UUID that the skill passes into `register_claude_session` as `claudeSessionId`.

*(Alternative, if we want defensive validation that the file exists: `test -r "/tmp/.claude-session-id-$PPID" && cat "/tmp/.claude-session-id-$PPID" || echo "MISSING"`.)*

### 6.2 `$CLAUDE_PLUGIN_DATA` availability

Checked inside a Bash tool call:

```
echo "CLAUDE_PLUGIN_DATA=$CLAUDE_PLUGIN_DATA"
CLAUDE_PLUGIN_DATA=
```

**`$CLAUDE_PLUGIN_DATA` is NOT exported into the Bash tool environment.** Claude Code exports it only into *hook command* environments, not into tool-executed shells. This rules out using `$CLAUDE_PLUGIN_DATA` from inside the `/collab` skill's Bash calls.

However, the directory itself does exist on disk at the conventional path:

```
ls ~/.claude/plugins/data/
  mermaid-collab-mermaid-collab-dev/
  clangd-lsp-claude-plugins-official/
  swift-lsp-claude-plugins-official/
```

So a skill Bash call *could* read from `~/.claude/plugins/data/mermaid-collab-*/sessions/` if we needed to — but we don't, because the PID-keyed file lives in `/tmp`, which is universally readable. **The PID-keyed design doesn't need `$CLAUDE_PLUGIN_DATA` anywhere except (optionally) inside the hook scripts, which DO see it.**

**Storage decision**: keep using `/tmp/.claude-session-id-<PID>` (already written, already working). The binding files (`binding-<session_id>.json`) can live in `$CLAUDE_PLUGIN_DATA/sessions/` for hooks (which have the env var) and — since the MCP server process does NOT have `$CLAUDE_PLUGIN_DATA` either (it's launched by `concurrently`, not by a Claude hook) — the MCP server must compute the same path via a convention: `~/.claude/plugins/data/mermaid-collab-<marketplace>-<plugin>/sessions/`. That's brittle because the marketplace slug can vary.

**Better storage decision**: put binding files in `/tmp` too, alongside the PID file. `/tmp/.mermaid-collab-binding-<session_id>.json`. Both hooks and the MCP server can reach it with a hard-coded path, no env var lookups, no convention-guessing. Trade-off: bindings are lost on reboot — but so is the Claude process itself, so re-running `/collab` after reboot is already expected. Acceptable.

### 6.3 Concurrent Claudes in the same cwd

Walk-through with two Claude instances (PID A = 18378, PID B = 55555) both running in `/Users/benmaderazo/Code/claude-mermaid-collab`.

1. **Claude A starts.** SessionStart hook fires with `session_id=SID_A`. Parent-walk finds claude PID 18378. Writes `/tmp/.claude-session-id-18378 = SID_A`.
2. **Claude B starts.** SessionStart hook fires with `session_id=SID_B`. Parent-walk finds claude PID 55555. Writes `/tmp/.claude-session-id-55555 = SID_B`. **No collision** — distinct filenames.
3. **User runs `/collab` in Claude A.** Skill Bash call: `cat /tmp/.claude-session-id-$PPID` → `PPID=18378` → reads `SID_A`. Calls `register_claude_session(project, session_a, claudePid=18378)`. MCP tool reads `/tmp/.claude-session-id-18378`, gets `SID_A`, writes `/tmp/.mermaid-collab-binding-SID_A.json = {project, session_a, claudePid:18378}`.
4. **User runs `/collab` in Claude B.** Skill Bash call: `PPID=55555` → reads `SID_B`. Writes `/tmp/.mermaid-collab-binding-SID_B.json = {project, session_b, claudePid:55555}`. **No collision** — distinct session ids, distinct binding filenames, distinct collab sessions.
5. **Claude A makes a tool call.** `PreToolUse` hook fires with `session_id=SID_A` on stdin. Hook reads `/tmp/.mermaid-collab-binding-SID_A.json` → `{project, session_a, ...}`. POSTs to server with those values.
6. **Claude B makes a tool call.** Same flow with `SID_B` → binding for `session_b`. Server broadcasts the right status to the right UI subscription.

**No collision points**, because every layer is keyed by globally unique `session_id` (from Claude Code itself) after the initial PID bootstrap. The PID is only used **once per Claude boot**, in the bootstrap step where the skill discovers its session id — and PIDs are guaranteed unique at any given instant.

### 6.4 Race conditions and edge cases

1. **SessionStart vs `/collab` timing.** `SessionStart` is synchronous at Claude boot, completing before the user can type `/collab`. Even at Claude startup speed, there is no realistic race. Defensive fallback: if the skill's Bash call reads an empty/missing file, it retries once with a 100 ms sleep, then errors out with a clear message.
2. **PID recycling.** The PID file is written by SessionStart and re-read by `register_claude_session` and then immediately superseded by the binding file. Between those two events the PID cannot be recycled into another Claude CLI because the current Claude CLI still holds it. After that, the PID file is no longer consulted — only the binding file (keyed by session_id) is. So PID recycling across the OS lifetime is harmless: at most one stale `/tmp/.claude-session-id-<pid>` file exists, and nothing reads it except the one-time bootstrap.
3. **Stale files on crash.** If Claude crashes, `/tmp/.claude-session-id-<pid>` and `/tmp/.mermaid-collab-binding-<session_id>.json` stay on disk. The SessionStart hook's cleanup routine (see implementation) prunes any `/tmp/.claude-session-id-*` whose PID is not a live `claude` process, and any `/tmp/.mermaid-collab-binding-*` older than N days. Since the OS also wipes `/tmp` on reboot, worst case is some orphaned files within a single boot session — harmless.
4. **`/clear` and `/compact` change `session_id` while keeping the PID.** On `source=clear` or `source=compact`, the SessionStart hook fires again with the **same** Claude PID but a **new** `session_id`. The hook:
   - overwrites `/tmp/.claude-session-id-<PID>` with the new id (fine, stale old id reference is only used if someone re-runs `/collab`);
   - reads the *old* session id from the file before overwriting;
   - if `/tmp/.mermaid-collab-binding-<OLD_SID>.json` exists, copies it to `/tmp/.mermaid-collab-binding-<NEW_SID>.json` (with the new session id baked in) so subsequent `PreToolUse` hooks dispatching by the new stdin `session_id` find the inherited binding;
   - optionally deletes the old binding file after copy, or leaves it to be pruned later.
   - Result: `/clear` and `/compact` keep the UI dot bound without user intervention.
5. **User runs `/collab` in Claude A, then kills Claude A, then a new process takes PID 18378 but is NOT a Claude.** The old binding file `/tmp/.mermaid-collab-binding-<SID_A>.json` is still on disk. No hooks will ever reference `SID_A` again (no Claude has that session id), so the file is dead weight until pruned. Not a bug — just clutter. Cleanup handles it.
6. **Server restart with live Claudes.** Binding files are on disk, so hooks continue to POST correctly after server restart. Server is now stateless (no `claudeSessionMap`) — nothing to rebuild. The first hook POST after restart re-populates the UI via websocket broadcast. **Strict improvement over today.**
7. **Multiple subagents within one Claude.** All subagents share the same CLI process and the same `session_id` on hook stdin (confirmed in debug files — `agent_id` is separate from `session_id`). They route to the same binding file, same UI dot. Correct.

### 6.5 Final implementation design

All paths absolute.

#### 6.5.1 `/Users/benmaderazo/Code/claude-mermaid-collab/scripts/session-start-hook.sh`

```bash
#!/bin/bash
# SessionStart hook: records the current Claude session_id keyed by Claude PID
# (discovered by walking the parent chain). Also carries bindings forward on
# /clear and /compact.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SOURCE=$(echo "$INPUT"    | jq -r '.source // empty'     2>/dev/null)

# Walk up to find the claude CLI PID (unchanged — this already works).
CLAUDE_PID=""
PID=$PPID
while [ "$PID" != "1" ] && [ -n "$PID" ] && [ "$PID" != "0" ]; do
  CMD=$(ps -o command= -p "$PID" 2>/dev/null || true)
  if echo "$CMD" | grep -qE "(^|/)claude( |$)"; then
    CLAUDE_PID="$PID"
    break
  fi
  PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ' || true)
done

if [ -n "$SESSION_ID" ] && [ -n "$CLAUDE_PID" ]; then
  PID_FILE="/tmp/.claude-session-id-$CLAUDE_PID"

  # Read any previous session id for this PID (needed for clear/compact carry).
  OLD_SID=""
  [ -f "$PID_FILE" ] && OLD_SID=$(cat "$PID_FILE" 2>/dev/null | tr -d '\n')

  # Write the new session id.
  echo "$SESSION_ID" > "$PID_FILE" 2>/dev/null

  # Clear/compact: carry the binding file forward so the UI dot stays bound.
  if { [ "$SOURCE" = "clear" ] || [ "$SOURCE" = "compact" ]; } \
     && [ -n "$OLD_SID" ] && [ "$OLD_SID" != "$SESSION_ID" ]; then
    OLD_BINDING="/tmp/.mermaid-collab-binding-$OLD_SID.json"
    NEW_BINDING="/tmp/.mermaid-collab-binding-$SESSION_ID.json"
    if [ -f "$OLD_BINDING" ]; then
      # Rewrite with new claudeSessionId embedded.
      jq --arg sid "$SESSION_ID" '.claudeSessionId = $sid' "$OLD_BINDING" \
        > "$NEW_BINDING" 2>/dev/null
      rm -f "$OLD_BINDING" 2>/dev/null
    fi
  fi
fi

# Prune stale /tmp/.claude-session-id-* files whose PID no longer refers to a
# live `claude` process. Cheap: at most ~a handful of files.
for f in /tmp/.claude-session-id-*; do
  [ -f "$f" ] || continue
  stale_pid="${f##*/.claude-session-id-}"
  [[ "$stale_pid" =~ ^[0-9]+$ ]] || { rm -f "$f"; continue; }
  stale_cmd=$(ps -o command= -p "$stale_pid" 2>/dev/null || true)
  if ! echo "$stale_cmd" | grep -qE "(^|/)claude( |$)"; then
    rm -f "$f" 2>/dev/null
  fi
done

echo '{"continue": true}'
exit 0
```

#### 6.5.2 `/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts` — rewrite `register_claude_session` (around line 2903)

```ts
case 'register_claude_session': {
  const { project, session, claudePid } = args as {
    project: string;
    session: string;
    claudePid?: number | string;
  };
  if (!project || !session) throw new Error('Missing required: project, session');
  if (!claudePid) {
    return JSON.stringify({
      success: false,
      error: 'Missing claudePid. The /collab skill must pass it — see skill doc.',
    });
  }

  const fs = await import('fs');
  const pidFile = `/tmp/.claude-session-id-${claudePid}`;
  let claudeSessionId: string;
  try {
    claudeSessionId = fs.readFileSync(pidFile, 'utf-8').trim();
  } catch {
    return JSON.stringify({
      success: false,
      error: `No session file at ${pidFile}. Restart Claude Code so the SessionStart hook can run.`,
    });
  }
  if (!claudeSessionId) {
    return JSON.stringify({ success: false, error: 'Empty session id file.' });
  }

  // Write the binding file that all subsequent hooks will read.
  const bindingPath = `/tmp/.mermaid-collab-binding-${claudeSessionId}.json`;
  fs.writeFileSync(
    bindingPath,
    JSON.stringify({
      claudeSessionId,
      project,
      session,
      claudePid: Number(claudePid),
      boundAt: Date.now(),
    })
  );

  // Broadcast initial status so the UI dot lights up immediately.
  const response = await fetch(buildUrl('/api/claude-session/register', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claudeSessionId }),
  });
  return JSON.stringify(await response.json(), null, 2);
}
```

Also update the tool's input schema (around line 1440) to add `claudePid` as a required string/number:

```ts
properties: {
  project: { type: 'string', description: 'Project path' },
  session: { type: 'string', description: 'Collab session name' },
  claudePid: {
    type: 'string',
    description: 'Claude CLI PID, discovered by the /collab skill via Bash ($PPID). Required.',
  },
},
required: ['project', 'session', 'claudePid'],
```

#### 6.5.3 `/Users/benmaderazo/Code/claude-mermaid-collab/scripts/active-hook.sh`

```bash
#!/bin/bash
# PreToolUse hook: dispatch "active" status by reading the binding file keyed
# by the stdin session_id. No PID walking.
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && { echo '{"continue": true}'; exit 0; }

BINDING="/tmp/.mermaid-collab-binding-$SESSION_ID.json"
[ ! -f "$BINDING" ] && { echo '{"continue": true}'; exit 0; }

PROJECT=$(jq -r '.project // empty' < "$BINDING")
COLLAB_SESSION=$(jq -r '.session // empty' < "$BINDING")
[ -z "$PROJECT" ] || [ -z "$COLLAB_SESSION" ] && { echo '{"continue": true}'; exit 0; }

curl -s -X POST http://localhost:3737/api/session-notify \
  -H "Content-Type: application/json" \
  -d "$(jq -nc \
        --arg sid "$SESSION_ID" \
        --arg p "$PROJECT" \
        --arg s "$COLLAB_SESSION" \
        --arg st "active" \
        '{claudeSessionId:$sid, project:$p, session:$s, status:$st}')" \
  > /dev/null 2>&1 &

echo '{"continue": true}'
exit 0
```

#### 6.5.4 `notification-hook.sh` and `permission-hook.sh`

Identical to `active-hook.sh` except `--arg st "waiting"` and `--arg st "permission"` respectively.

#### 6.5.5 `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/api.ts`

- **Delete** the `claudeSessionMap` (`src/routes/api.ts:58-63`). Nothing needs it.
- **Keep** `/api/claude-session/register` but strip it to a broadcast-only endpoint:

  ```ts
  if (path === '/api/claude-session/register' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }
    const { claudeSessionId } = await req.json() as { claudeSessionId?: string };
    if (!claudeSessionId) {
      return Response.json({ error: 'claudeSessionId required' }, { status: 400 });
    }
    wsHandler.broadcast({
      type: 'claude_session_registered',
      claudeSessionId,
      project: params.project,
      session: params.session,
    });
    return Response.json({ success: true, claudeSessionId });
  }
  ```

- **Rewrite** `/api/session-notify` to be stateless — accept and broadcast the full payload from the hook:

  ```ts
  if (path === '/api/session-notify' && req.method === 'POST') {
    const { claudeSessionId, project, session, status } = await req.json() as {
      claudeSessionId?: string; project?: string; session?: string; status?: string;
    };
    if (!claudeSessionId || !project || !session || !status) {
      return Response.json({ error: 'claudeSessionId, project, session, status required' }, { status: 400 });
    }
    wsHandler.broadcast({
      type: 'claude_session_status',
      claudeSessionId,
      project,
      session,
      status,
      lastUpdate: Date.now(),
    });
    return Response.json({ success: true });
  }
  ```

#### 6.5.6 `/Users/benmaderazo/Code/claude-mermaid-collab/skills/collab/SKILL.md`

Add a new sub-step to Step 3 and Step 4 **before** calling `register_claude_session`:

```
Before registering, discover this Claude Code process's PID so register_claude_session can look up its session id. Run:

Tool: Bash
Command: echo "$PPID"

The printed number is the Claude CLI PID (verified empirically — the Bash tool forks /bin/zsh as a direct child of Claude, so $PPID inside the command IS Claude's PID). Pass it as the claudePid argument.

Tool: mcp__plugin_mermaid-collab_mermaid__register_claude_session
Args: { "project": "<cwd>", "session": "<name>", "claudePid": "<the number from $PPID>" }
```

(Optionally combine into one call: `echo "$PPID"` + passing the result. Or read directly: `cat "/tmp/.claude-session-id-$PPID"` — but since the MCP tool re-reads the same file anyway, passing just the PID is simpler and keeps the session-id truth in one place.)

#### 6.5.7 New cleanup logic

- SessionStart hook: prune `/tmp/.claude-session-id-*` whose PID is not a live claude process (included in 6.5.1 above).
- SessionStart hook or a separate periodic task: prune `/tmp/.mermaid-collab-binding-*.json` older than 7 days (or whose `claudePid` is not a live claude process). Low priority — `/tmp` reboots handle worst case.

#### 6.5.8 What stays as-is

- UI (`ui/src/App.tsx`, `ui/src/stores/subscriptionStore.ts`) — no change. The existing `claude_session_status` and `claude_session_registered` broadcast shapes are already `{claudeSessionId, project, session, status}`.
- Plugin hooks registration in `.claude-plugin/plugin.json` — no change.

### 6.6 Verdict

**GO.** The PID-keyed design is structurally sound and strictly better than the cwd-keyed Design A for the multi-Claude-in-same-cwd scenario. All concerns are mitigated:

- The open question — "is `$PPID` in a Bash tool command the Claude CLI?" — is answered **yes, directly, empirically verified** on this machine (`$PPID=18378`, `ps` confirms PID 18378 is `claude`, matches the existing `/tmp/.claude-session-id-18378` file).
- The `$CLAUDE_PLUGIN_DATA` unavailability in the Bash tool is a non-issue: everything lives in `/tmp`, no env var needed anywhere.
- Concurrent Claudes in the same cwd → no collision (distinct PIDs → distinct PID files → distinct session ids → distinct bindings → distinct UI dots).
- `/clear` and `/compact` handled by the SessionStart hook carrying the binding forward.
- Server becomes stateless; survives restarts without needing users to re-run `/collab`.
- PID recycling is theoretical and harmless (only the one-time bootstrap reads the PID file).

The change set is small: one rewrite of `session-start-hook.sh`, three near-identical rewrites of the other hook scripts, ~30 lines changed in `src/mcp/setup.ts`, ~40 lines changed in `src/routes/api.ts`, a small addition to `skills/collab/SKILL.md`. No UI changes.

**Recommendation: proceed.**
