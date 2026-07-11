# Design: Project-scope tmux session names

## Problem

The tmux session that backs a collab session is keyed by **session name only**. Two
projects with a session named `design` both resolve to one tmux session and stomp
each other (the second `create-terminal` hits "duplicate session" and silently
reuses the first project's session; reattach/focus can target the wrong window).

`project` is already available at every layer — it's just dropped before the tmux
name is built.

## Decision (confirmed)

- **Scope:** VS Code one-click flow only. The legacy `terminal-manager.ts`
  (`mc-{session}-{random}` + `mc-{session}-` reconcile prefix) is **out of scope**
  for this change.
- **Naming scheme:** `mc-{projectBasename}-{session}`, no hash. Readable in `tmux ls`.
- **Process:** design doc → review → implement.

### Caveat accepted with the no-hash scheme

`mc-{projectBasename}-{session}` is unique per (project, session) **unless two
different project paths share the same last folder name** (e.g. `~/work/app` and
`~/personal/app` → both `mc-app-{session}`). That residual collision is accepted for
now; if it ever bites, we add a short hash of the full project path as a suffix
(`mc-{basename}-{session}-{hash6}`) — a localized change to one helper.

## Naming helper

A single pure function defines the scheme. No hashing, so it is trivially and safely
replicated where bundle boundaries prevent a shared import.

```ts
// slug: lowercase, alphanumeric only (no hyphens inside a part, so the
// separators between mc / basename / session stay unambiguous)
function tmuxBaseName(project: string, session: string): string {
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'x';
  const basename = project.split('/').filter(Boolean).pop() ?? 'project';
  return `mc-${slug(basename)}-${slug(session)}`;
}
// /Users/.../claude-mermaid-collab  +  bugfixes  →  mc-claudemermaidcollab-bugfixes
```

## Single source of truth

The **server** owns the canonical name. It computes `tmuxBaseName(project, session)`
and includes it as a new `tmuxSession` field in the `ide_open_terminal` and
`ide_reattach` broadcasts. The **extension** uses the supplied `tmuxSession` verbatim
(no duplicated logic). The **UI** needs the name only for the green/red "tmux active"
indicator, so it replicates the tiny pure function (safe — no hash).

## File-by-file changes

### New: `src/services/tmux-naming.ts`
- Export `tmuxBaseName(project, session)` (above). Used by ide-routes + ide-state.

### `src/routes/ide-routes.ts`
- `POST /api/ide/create-terminal`: accept `{ session, project }`. Require `project`.
  Create `tmux new-session -d -s <tmuxBaseName(project, session)>`.
  Broadcast `ide_open_terminal` with `{ session, project, tmuxSession }`.

### `src/services/ide-state.ts`
- `ideConnected` reattach loop: add `tmuxSession: tmuxBaseName(project, session)` to
  the `ide_reattach` payload.

### `src/websocket/handler.ts`
- Extend the `ide_reattach` message type with `tmuxSession: string`.

### `extensions/vscode/src/extension.ts`
- `ide_open_terminal` handler: pass `{ session, project, tmuxSession }` through.
- `ide_reattach` handler / `handleIdeReattach`: thread `tmuxSession` through the queue.
- `processOneReattach`: use `msg.tmuxSession` for the base/target and grouped name
  (`vscode-collab-${tmuxSession}`). Terminal **display name** = `${session} · ${projectBasename}`
  (unique + readable). Dedup/`find` by this display name.
- `focusTerminal`: thread `project` so the name-match fallback uses the same unique
  display name instead of bare `session`.

### `ui/src/components/layout/SubscriptionsPanel.tsx`
- 3 `create-terminal` callers: add `project: sub.project` to the POST body.
- `tmuxActive`: change `tmuxSessions.has(sub.session)` →
  `tmuxSessions.has(tmuxBaseName(sub.project, sub.session))` (replicate the helper).

## Migration

Existing tmux sessions named plainly `{session}` (e.g. `bugfixes`) will no longer be
auto-matched after the change — kill the old ones once (`tmux kill-session -t <name>`).
No data migration; tmux state is ephemeral.

## Test plan

- Unit: `tmuxBaseName` — slugging, truncation, basename extraction, two projects with
  same session name → different names; two same-basename paths → documented collision.
- Manual: two projects each with session `design`; create-terminal in both →
  two distinct tmux sessions; reattach/focus hit the correct window; UI indicator
  green for the right project's row.
