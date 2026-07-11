# Completeness Review

## Verdict: COMPLETE — 0 gaps found

All 6 blueprint tasks are fully implemented with no stubs, TODOs, or missing pieces.

---

## Task-by-Task Verification

### 1. tmux-naming ✓
- `src/services/tmux-naming.ts` — exists, exports `tmuxBaseName(project, session)` exactly as specced: slug = lowercase alphanumeric ≤24 chars, fallback `'x'`; basename from last path segment; returns `` `mc-${slug(basename)}-${slug(session)}` ``.
- `src/services/__tests__/tmux-naming.test.ts` — exists, 8 vitest cases: happy path, symbol stripping, trailing slash, 24-char truncation, all-symbols→x fallback ×2, cross-project distinctness, documented same-basename collision.
- **Tests: 8/8 pass** (vitest run confirmed).

### 2. ws-handler-types ✓
- `src/websocket/handler.ts` lines 87–89:
  - `ide_open_terminal` member: `{ type: 'ide_open_terminal'; session: string; project: string; tmuxSession: string }` ✓
  - `ide_reattach` member: `{ type: 'ide_reattach'; claudePid: number; claudeSessionId: string; project: string; session: string; tmuxSession: string; boundAt: string }` ✓

### 3. ide-routes ✓
- `src/routes/ide-routes.ts`:
  - Imports `tmuxBaseName` from `../services/tmux-naming.js` ✓
  - `POST /api/ide/create-terminal` destructures `{ session, project }`, validates both with 400 on missing ✓
  - Computes `tmuxSession = tmuxBaseName(project, session)` ✓
  - Spawns `tmux new-session -d -s <tmuxSession>` (not bare session) ✓
  - Broadcasts `ide_open_terminal` with `{ session, project, tmuxSession }` ✓

### 4. ide-state ✓
- `src/services/ide-state.ts`:
  - Imports `tmuxBaseName` from `./tmux-naming.js` ✓
  - `ideConnected` reattach loop sends `tmuxSession: tmuxBaseName(project, session)` in the `ide_reattach` payload ✓

### 5. vscode-extension ✓
- `extensions/vscode/src/extension.ts`:
  - `projectBasename(project?)` and `terminalDisplayName(session, project?)` helpers added ✓
  - `reattachQueue` type includes `tmuxSession: string` ✓
  - `handleIdeReattach` param typed with `tmuxSession: string` ✓
  - `ide_focus_terminal` case passes `msg.project` to `focusTerminal` ✓
  - `ide_open_terminal` case passes `{ session, project, tmuxSession }` to `processOneReattach` ✓
  - `focusTerminal(targetPid, sessionHint, project?)` — name-match tries exact display name first (`terminalDisplayName`), falls back to session-substring ✓
  - `processOneReattach({ session, project?, tmuxSession? })` — display = `terminalDisplayName(session, project)`; base = `tmuxSession ?? session`; grouped = `vscode-collab-${base}`; dedup by display name ✓
  - Graceful fallback when `project`/`tmuxSession` absent ✓

### 6. ui-subscriptions ✓
- `ui/src/components/layout/SubscriptionsPanel.tsx`:
  - Local `tmuxBaseName(project, session)` replicated (lines 116–120), identical pure fn ✓
  - All 3 `create-terminal` fetch bodies send `{ session: sub.session, project: sub.project }` ✓ (card onClick, terminal button onClick, "open all" loop)
  - `tmuxActive={tmuxSessions.has(tmuxBaseName(sub.project, sub.session))}` — keys on derived name, not bare session ✓

---

## End-to-End Flow Check

**Server computes → broadcasts → extension consumes; UI sends project:**

1. UI → `POST /api/ide/create-terminal` with `{ session, project }` ✓
2. Server: `tmuxBaseName(project, session)` → spawns tmux with that name → broadcasts `ide_open_terminal` with `tmuxSession` field ✓
3. Extension: receives `ide_open_terminal`, calls `processOneReattach` with `tmuxSession` verbatim — no naming logic duplicated ✓
4. Reattach path: `ide-state` computes `tmuxBaseName(project, session)` → sends in `ide_reattach` → extension uses `msg.tmuxSession` verbatim ✓
5. UI indicator: replicates pure helper locally to check `tmuxSessions.has(tmuxBaseName(...))` — safe, no hash ✓

**No naming divergence:** extension never recomputes the name; it always uses the server-supplied `msg.tmuxSession`, falling back to bare `session` only when the field is absent (old server compatibility).

---

## Stub/TODO Scan

Grepped all 7 files for `TODO`, `Not implemented`, `NotImplementedError`, `todo!()` — **zero matches**.

---

## Post-Execution Follow-Ups (Consciously Deferred, NOT gaps)

As documented in the Wave 3 summary and blueprint:

1. **Extension rebuild required** — `extensions/vscode/src/extension.ts` changed but the running extension is the bundled `out/extension.js`. Rebuild needed: `cd extensions/vscode && npm run compile`. Repackage + bump `.vsix` to distribute.
2. **Kill old tmux sessions** — existing sessions named with the old scheme (bare `{session}`, e.g. `bugfixes`) will not be auto-matched. Kill once: `tmux kill-session -t <name>`. No data loss; tmux state is ephemeral.
