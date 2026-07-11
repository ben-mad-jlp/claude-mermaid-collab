# Blueprint: Project-scope tmux session names (VS Code one-click flow)

## Source Artifacts
- `design-tmux-project-scoping`

## 1. Structure Summary

### Files
- [ ] `src/services/tmux-naming.ts` — **new.** Pure `tmuxBaseName(project, session)` helper.
- [ ] `src/services/__tests__/tmux-naming.test.ts` — **new.** Unit tests for the helper.
- [ ] `src/websocket/handler.ts` — extend `ide_reattach` WSMessage member with `tmuxSession`; add `ide_open_terminal` member (`session`, `project`, `tmuxSession`).
- [ ] `src/routes/ide-routes.ts` — `create-terminal` takes `project`, names tmux session via helper, broadcasts `project` + `tmuxSession`.
- [ ] `src/services/ide-state.ts` — add `tmuxSession` to the `ide_reattach` broadcast.
- [ ] `extensions/vscode/src/extension.ts` — consume `tmuxSession`; unique readable terminal display name; thread `project` into `focusTerminal`.
- [ ] `ui/src/components/layout/SubscriptionsPanel.tsx` — send `project` in 3 callers; replicate helper for `tmuxActive`.

### Type Definitions

```ts
// src/websocket/handler.ts — WSMessage union
| { type: 'ide_reattach'; claudePid: number; claudeSessionId: string;
    project: string; session: string; tmuxSession: string; boundAt: string }
| { type: 'ide_open_terminal'; session: string; project: string; tmuxSession: string }
```

### Component Interactions
- **Server owns the canonical tmux name.** `tmuxBaseName(project, session)` is computed
  server-side in `ide-routes` (create path) and `ide-state` (reattach path) and shipped
  in the `tmuxSession` field of `ide_open_terminal` / `ide_reattach`.
- **Extension** uses `msg.tmuxSession` verbatim for the tmux base/target + grouped name
  (`vscode-collab-${tmuxSession}`). No naming logic duplicated.
- **UI** replicates the tiny pure helper only to compute the expected name for the
  green/red "tmux active" indicator (safe — no hashing).

---

## 2. Function Blueprints

### `tmuxBaseName(project: string, session: string): string`  (new, src/services/tmux-naming.ts)

**Pseudocode:**
1. `slug = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'x'`
2. `basename = project.split('/').filter(Boolean).pop() ?? 'project'`
3. return `` `mc-${slug(basename)}-${slug(session)}` ``

**Error handling:** none — pure, total function. Empty/odd inputs fall back to `'x'`/`'project'`.
**Edge cases:** trailing slash on project (filter Boolean handles it); session/basename of only-symbols → `'x'`; very long names truncated to 24 chars/part.
**Why no hyphens inside a part:** keeps the `mc-{basename}-{session}` separators unambiguous so `"ab"+"c"` ≠ `"a"+"bc"`.
**Test strategy:** see task `tmux-naming` tests below.

### `POST /api/ide/create-terminal`  (src/routes/ide-routes.ts)

**Pseudocode:**
1. Parse `{ session, project }`. Validate both are non-empty strings (400 otherwise).
2. `const name = tmuxBaseName(project, session)`
3. `Bun.spawn(['tmux', 'new-session', '-d', '-s', name])`; await exit (ok if duplicate).
4. Broadcast `{ type: 'ide_open_terminal', session, project, tmuxSession: name }`.
5. Return `{ success: true }`.

**Error handling:** keep existing try/catch → 500; spawn failure (dup session) is non-fatal.
**Edge cases:** missing `project` from older UI builds → 400 (UI is updated in same change).
**Test strategy:** extend/add a route test asserting the spawned `-s` arg = `tmuxBaseName(...)` and the broadcast payload includes `project` + `tmuxSession`.

### `ideConnected` reattach loop  (src/services/ide-state.ts)

**Pseudocode:** in the `for (...matches)` send loop, add
`tmuxSession: tmuxBaseName(project, session)` to the `ide_reattach` JSON payload.

**Edge cases:** none new — `project`/`session` already validated above in the loop.
**Test strategy:** if an ide-state test harness exists, assert the broadcast includes `tmuxSession`; otherwise covered by manual test.

### `processOneReattach(msg, showTerminal)`  (extensions/vscode/src/extension.ts)

**Pseudocode:**
1. `const tmux = msg.tmuxSession` (base/target name from server).
2. `const display = ` `` `${msg.session} · ${basename(msg.project)}` `` (readable + unique).
3. Dedup: `terminals.find(t => t.name === display)` (was bare `session`).
4. `groupedName = ` `` `vscode-collab-${tmux}` ``; cmd uses `-t '${tmux}'` and attaches to `groupedName`.
5. `createTerminal({ name: display, shellPath: '/bin/sh', shellArgs: ['-c', cmd] })`.

**Error handling:** unchanged (tmux has-session || new-session fallback inside the shell cmd).
**Edge cases:** `msg.project` absent (old server) → fall back to `session` for display + `tmuxSession ?? session` for base, so it degrades gracefully.
**Test strategy:** manual (extension runs in VS Code host).

### `focusTerminal(targetPid, sessionHint, project?)`  (extensions/vscode/src/extension.ts)

**Pseudocode:** PID match unchanged; name-match fallback compares against the same
`${session} · ${basename(project)}` display name (when `project` present) instead of
`name.includes(sessionHint)`.

**Edge cases:** `project` undefined → keep current `includes(sessionHint)` behavior.

### SubscriptionsPanel  (ui/src/components/layout/SubscriptionsPanel.tsx)

**Pseudocode:**
1. Add local `tmuxBaseName(project, session)` (identical pure fn).
2. 3 `create-terminal` fetch bodies: `JSON.stringify({ session: sub.session, project: sub.project })` (and `sub.project` in the "open all" loop).
3. `tmuxActive={tmuxSessions.has(tmuxBaseName(sub.project, sub.session))}` (was `.has(sub.session)`).

**Edge cases:** none — `sub.project` always present on a subscription row.
**Test strategy:** if a SubscriptionsPanel test exists, assert the POST body includes `project` and the indicator keys off the derived name.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: tmux-naming
    files: [src/services/tmux-naming.ts]
    tests: [src/services/__tests__/tmux-naming.test.ts]
    description: "New pure helper tmuxBaseName(project, session) → mc-{basename}-{session}, with unit tests (slug, truncation, basename extraction, distinct names for same session across projects, documented same-basename collision)."
    parallel: true
    depends-on: []
  - id: ws-handler-types
    files: [src/websocket/handler.ts]
    tests: []
    description: "Extend WSMessage: add tmuxSession to ide_reattach; add ide_open_terminal member (session, project, tmuxSession)."
    parallel: true
    depends-on: []
  - id: ide-routes
    files: [src/routes/ide-routes.ts]
    tests: [src/routes/__tests__/ide-routes-create-terminal.test.ts]
    description: "create-terminal accepts project, names tmux session via tmuxBaseName, broadcasts project + tmuxSession in ide_open_terminal."
    parallel: true
    depends-on: [tmux-naming, ws-handler-types]
  - id: ide-state
    files: [src/services/ide-state.ts]
    tests: []
    description: "Add tmuxSession: tmuxBaseName(project, session) to the ide_reattach broadcast payload."
    parallel: true
    depends-on: [tmux-naming, ws-handler-types]
  - id: vscode-extension
    files: [extensions/vscode/src/extension.ts]
    tests: []
    description: "Consume msg.tmuxSession for base/target + grouped name; unique readable terminal display name '{session} · {projectBasename}'; thread project into focusTerminal name match; graceful fallback when project/tmuxSession absent."
    parallel: true
    depends-on: [ide-routes, ide-state]
  - id: ui-subscriptions
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Send project in 3 create-terminal callers; replicate tmuxBaseName locally; tmuxActive checks the derived name."
    parallel: true
    depends-on: [ide-routes]
```

### Execution Waves

**Wave 1 (parallel):**
- tmux-naming, ws-handler-types

**Wave 2 (depends on Wave 1):**
- ide-routes, ide-state

**Wave 3 (depends on Wave 2):**
- vscode-extension, ui-subscriptions

### Summary
- Total tasks: 6
- Total waves: 3
- Max parallelism: 2

### Post-execution (manual, out of task graph)
- Rebuild + repackage the VS Code extension (`out/extension.js`, bump `.vsix`).
- Kill any pre-existing plainly-named tmux sessions once (migration note).
