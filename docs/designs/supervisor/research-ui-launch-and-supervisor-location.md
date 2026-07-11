# UI Launch-and-Bind + Standardized Supervisor Location — Design / Gap Memo

## 1. Per-server routing verdict: SOUND

`mc.invokeOnServer(serverId, { path, method, body, query })` is the correct primitive and already does exactly what a launch needs.

- **Renderer contract:** `ui/src/contexts/ServerContext.tsx:55` (type), used throughout (`SubscriptionsPanel.tsx`, `SupervisorPanel.tsx`, `terminalStore.ts`, `lib/api.ts`).
- **Preload bridge:** `desktop/src/preload/index.ts:16` — `invokeOnServer` → `ipcRenderer.invoke('mc:invokeOnServer', serverId, opts)`.
- **Main impl:** `desktop/src/main/index.ts:88-113`. It looks up the server by id in the connection `store`, then does a real `fetch('http://${entry.host}:${entry.port}${opts.path}', { method, headers (Bearer entry.token), body })` with an 8s timeout. So **the request runs against that machine's server process** — i.e. the launch executes ON the target host. Tokens stay in main; returns `{ ok, status, body }`.

**Does the row carry the remote-host path?** Yes. Watching rows are `SubscribedSession { serverId, project, session }`. The existing create-terminal call (`SubscriptionsPanel.tsx:242-246` and `:357-361`) already sends `{ session: sub.session, project: sub.project }` to that row's `sub.serverId`, and `create-terminal` (`src/routes/ide-routes.ts:57`) runs `tmux new-session` on that server's host using exactly that `project`. So `sub.project` is the project path **as it exists on the owning server's host** — never a local-renderer path. A `Start session` button can mirror this 1:1:

```
mc.invokeOnServer(sub.serverId, { path: '/api/ide/launch-session', method: 'POST',
  body: { project: sub.project, session: sub.session, role: 'worker' } })
```

This is sound with no new routing work required.

## 2. `POST /api/ide/launch-session` endpoint design

New route alongside the others in `src/routes/ide-routes.ts` (sibling to `create-terminal` at :57 and `tmux-send-keys` at :95). Body: `{ project, session, role?: 'worker'|'supervisor', allowedTools?: string }`. All steps run locally on the server's host.

**a. Create tmux in the project dir.** Today `create-terminal` deliberately omits `-c` (`new-session -d -s <name>`, ide-routes.ts:70 — bare shell, server cwd). For launch we DO want the project dir as cwd, so use `tmux new-session -d -s <tmuxBaseName(project,session)> -c <project>`. `-c` is the documented tmux flag to set the new session's working directory; the dir must exist on that host (it does — it's a registered project path on that server). Reuse `tmuxBaseName` from `src/services/tmux-naming.ts` so the tmux name matches what `tmux-send-keys` / terminal-attach already expect.

**b. Launch claude.** After creating the session, type the launch command via `sendTmuxKeysRaw(tmux, cmd)` (`src/services/tmux-send.ts:19` — types literal text then a separate Enter, which is what reliably submits). For a worker: `claude --allowedTools "<allow-list>"` (pass-through from `allowedTools`, default to the project's standard collab allow-list). For supervisor: plain `claude` (the supervisor skill's own `allowed-tools` frontmatter governs it once invoked).

**c. Bind after readiness.** After claude is up, `sendTmuxKeysRaw(tmux, '/collab <session>')`. The `/collab <name>` path is the right bind (skills/collab/SKILL.md:42 — invoked with a session-name arg → calls `register_claude_session`).

**Readiness — recommendation: poll the SessionStart hook's pid file, with a delay fallback.** A fixed delay is fragile (cold MCP start, plugin load). There IS a robust local signal: the SessionStart hook writes `/tmp/.claude-session-id-<claudePid>` (referenced at `src/mcp/setup.ts:1654`, `:3036`, `src/routes/api.ts:2488`, `cdp-session.ts:108`). The endpoint can't know the new claude PID directly, BUT it can: (i) capture the tmux pane's child pid after launch (`tmux list-panes -t <s> -F '#{pane_pid}'`, then walk for the `claude`/`node` child), then (ii) poll for `/tmp/.claude-session-id-<pid>` to appear (≤ ~30s, 250ms interval). When it appears, claude has booted far enough that `/collab` will register cleanly. If pid resolution is unreliable, fall back to a fixed delay (e.g. 4–6s) before sending `/collab`. Treat the whole launch as **best-effort/async**: return as soon as tmux+launch are issued; the bind fires on a background timer/poll.

**d. Trust-prompt caveat (the real blocker).** A claude started in a NEVER-trusted dir shows the "Do you trust the files in this folder?" prompt, which **swallows the `/collab` keystrokes** and blocks bind. Mitigations, in order:
- The supervisor dir and any worker dirs SHOULD be pre-trusted (Claude records trusted dirs in its config). Document this as a setup requirement.
- Alternatively launch with a flag that skips/auto-accepts the trust prompt if available in the installed claude version; otherwise the endpoint could detect the prompt is showing and not blindly fire `/collab`.
- Safest default: only offer `Start` for projects already known/trusted on that host; for the standardized supervisor dir, ensure it is trusted at install time.

**e. Return shape.** `{ started: true, tmux: '<tmuxBaseName>', bind: 'pending' }`. The bind result is async; optionally expose a follow-up status (e.g. reuse `/api/session-status` once the worker registers). Match `create-terminal`'s soft-failure style: if tmux isn't installed, return `{ started:false, tmux:false }` rather than 500 (ide-routes.ts:78-89 pattern).

## 3. Standardized supervisor location — recommendation: ONE SUPERVISOR PER SERVER (v1)

**Current reality is per-server and local-only:**
- Supervisor identity is a **singleton row in each server's own SQLite** (`supervisor-store.ts:261` `INSERT OR REPLACE ... id=1`; read at `:268`). There is no global/shared identity — each server has at most one supervisor, recorded in that server's DB.
- The real-time push is **local**: `/api/session-notify` (`src/routes/api.ts:2445-2462`) calls `sendTmuxKeys(sup.project, sup.session, ...)` — i.e. `tmux send-keys` ON THAT SERVER'S HOST. It can only nudge a supervisor tmux living on the same machine.
- Transcript reads (`transcript-reader.ts`) and `tmux-send-keys` are likewise host-local.

So the natural, already-supported model is **one supervisor per server, supervising that server's local sessions.** Recommend shipping that as v1.

**Where the standardized config lives.** There is currently no `supervisorProject` config. Two viable homes:
- **(Recommended) A per-server config value** read at server startup, analogous to `MERMAID_PROJECT`/`MERMAID_SESSION` in `src/config.ts:84,90`. Add `MERMAID_SUPERVISOR_PROJECT` (default: `MERMAID_PROJECT`, or the install path from `get_install_path` = plugin root, `src/mcp/setup.ts:3117-3124`) plus a fixed session name `MERMAID_SUPERVISOR_SESSION` (default `'supervisor'`). The launch endpoint and the `Start supervisor` button both read these so the dir+session are canonical and consistent.
- The Claude-Code settings layering in `src/agent/settings-store.ts` is NOT the right place — it's for permissions/hooks/env merging, not server identity.

**Canonical pair:** `(supervisorProject, 'supervisor')` per server. tmux name therefore deterministic: `tmuxBaseName(supervisorProject, 'supervisor')`. The dir must be a registered + TRUSTED project on that host (see 2d).

**Single GLOBAL supervisor is NOT feasible now** without per-server hops. A supervisor on machine A driving a worker on machine B would require routing EACH of these through the owning server:
- the **push** (`session-notify` → currently local `sendTmuxKeys`) would need to target the supervisor's server, not the worker's;
- the **nudge** (supervisor → idle worker `tmux send-keys`) would need a remote `tmux-send-keys` call to the worker's server;
- the **transcript read** for reconcile would need a remote fetch to the worker's server.
That is a meaningful multi-hop feature. Defer to a follow-up; v1 = per-server local supervision.

## 4. `Start supervisor` flow

`supervisor` IS user-invocable (`skills/supervisor/SKILL.md:4` `user-invocable: true`). The skill self-registers via `register_supervisor` on session start (SKILL.md:28 → `setSupervisorIdentity`, setup.ts:3436-3439).

Recommended launch sequence (role:'supervisor'), all on the target server:
1. `tmux new-session -d -s <tmuxBaseName(supervisorProject,'supervisor')> -c <supervisorProject>`.
2. `sendTmuxKeysRaw(tmux, 'claude')` (plain).
3. After readiness: `sendTmuxKeysRaw(tmux, '/collab supervisor')` — binds the collab session.
4. Then `sendTmuxKeysRaw(tmux, '/supervisor')` — invokes the skill, which calls `register_supervisor` (recording the singleton identity for THIS server) and runs its reconcile/escalation bootstrap.

`/collab` first (bind the collab session so artifacts/notifications attach), then `/supervisor` (enter supervisor mode). Both are separate sends with their own readiness gap; the `/supervisor` send should follow `/collab` after a short delay or after the registration is observable.

## 5. UI affordances

- **Per-row `Start` (play) button** in `SubscriptionsPanel` Watching rows, next to the existing supervise-toggle (`SubscriptionsPanel.tsx:339`) and create-terminal button (`:351`). Reuse the exact routing pattern already there: `mc.invokeOnServer(sub.serverId, { path:'/api/ide/launch-session', method:'POST', body:{ project: sub.project, session: sub.session, role:'worker' } })`. Disable/hide when the row's server lacks tmux (reuse `fetchCapabilities(sub.serverId)`, already used at :239,:354).
- **`Start supervisor` button** in the `SupervisorPanel` header (`SupervisorPanel.tsx:281-310`, beside the collapse caret / escalation badge). It launches the standardized supervisor on the active/selected server: `mc.invokeOnServer(activeId, { path:'/api/ide/launch-session', method:'POST', body:{ role:'supervisor' } })` — the endpoint fills project/session from the server's `supervisorProject`/`'supervisor'` config so the renderer needn't know the remote path. Optionally surface the resolved supervisor identity via `getSupervisorIdentity` (already read by SupervisorPanel data path) to show running/not-running.

## 6. Cross-machine supervision gap (explicit)

Cross-machine = supervisor on server A overseeing workers on server B. Requires three per-server hops not present today:
1. **Push hop:** `session-notify` on B must route the `[mc-supervisor]` nudge to A's host (A's `tmux send-keys`), not call B-local `sendTmuxKeys`. Needs a registry of "which server hosts the supervisor" reachable from B (today the supervisor identity is private to each server's DB).
2. **Nudge hop:** supervisor's own outbound nudges to idle workers on B must go through B's `tmux-send-keys` endpoint (a remote `invokeOnServer`-style call from server to server, or proxied via the desktop main).
3. **Transcript hop:** reconcile reads of B's worker transcripts must fetch from B.
Conclusion: keep v1 local-per-server; cross-machine is a distinct follow-up requiring a server-to-server control channel (or routing all three through the desktop main as the hub).

## 7. KEEP / BUILD task list

**KEEP (already correct, reuse as-is):**
- `mc.invokeOnServer` routing (preload→main fetch to host:port with token) — `desktop/src/main/index.ts:88`.
- `SubscribedSession.{serverId,project}` carrying the remote-host project path — `SubscriptionsPanel.tsx:242`.
- `tmuxBaseName(project,session)` — `src/services/tmux-naming.ts:12`.
- `sendTmuxKeysRaw` literal-then-Enter submit — `src/services/tmux-send.ts:19`.
- `/tmp/.claude-session-id-<pid>` SessionStart-hook readiness signal — `src/mcp/setup.ts:3036`.
- Singleton per-server supervisor identity + local `session-notify` push — `supervisor-store.ts:261`, `api.ts:2445`.
- `/collab <name>` bind path & `supervisor` skill (user-invocable, self-registers) — `skills/collab/SKILL.md:42`, `skills/supervisor/SKILL.md:4,28`.

**BUILD:**
1. `POST /api/ide/launch-session` in `src/routes/ide-routes.ts` — `tmux new-session -c <project>`, launch claude (worker flags / plain supervisor), background readiness poll + `/collab` (+ `/supervisor` for role:supervisor), best-effort return.
2. Server config `MERMAID_SUPERVISOR_PROJECT` (default = install path / `MERMAID_PROJECT`) and `MERMAID_SUPERVISOR_SESSION='supervisor'` in `src/config.ts`; endpoint defaults from these for role:'supervisor'.
3. Readiness helper: resolve new claude PID from tmux pane, poll for the pid file (with delay fallback).
4. Trust-dir handling: pre-trust the supervisor dir at install; document worker-dir trust requirement; optionally detect trust prompt before sending `/collab`.
5. UI: per-row `Start` button (SubscriptionsPanel) and `Start supervisor` header button (SupervisorPanel), both via `invokeOnServer` at the row/active serverId; gate on tmux capability.
6. (Follow-up, not v1) Cross-machine supervision: server-to-server control channel for the push / nudge / transcript-read hops.

## Top risks
1. **Trust prompt swallows `/collab`** — the #1 cause of a launch that "starts" but never binds. Pre-trust required.
2. **Readiness timing** — fixed delay is unreliable; PID→pidfile poll is the robust path but PID resolution from the tmux pane needs care.
3. **Cross-machine supervision is out of scope for v1** — the push/nudge/transcript are all host-local today; setting a global supervisor would silently fail to drive remote workers.
4. **Dir must exist + be a registered project on the target host** for `-c <project>` to succeed (true for Watching rows; must be guaranteed for the supervisor dir).
