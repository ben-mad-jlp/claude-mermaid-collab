# Wave 3 Implementation

## Tasks

### vscode-extension
- `extensions/vscode/src/extension.ts` — 7 edits:
  - Added `projectBasename(project?)` + `terminalDisplayName(session, project?)` helpers.
  - `reattachQueue` type + `handleIdeReattach` param + `ide_reattach` cast: added `tmuxSession: string`.
  - `ide_focus_terminal` case → passes `msg.project` to `focusTerminal`.
  - `ide_open_terminal` case → passes `{ session, project, tmuxSession }` to `processOneReattach`.
  - `focusTerminal(targetPid, sessionHint, project?)` → name-match now tries exact display name first, then session-substring fallback.
  - `processOneReattach({ session, project?, tmuxSession? })` → terminal display name = `"{session} · {projectBasename}"`; tmux base = `tmuxSession ?? session`; grouped = `vscode-collab-{base}`.
  - Graceful fallback when `project`/`tmuxSession` absent (older server).
  - Before/after diagram: `Implementing/Go/Wave 3/vscode-extension/extension.ts`.

### ui-subscriptions
- `ui/src/components/layout/SubscriptionsPanel.tsx`:
  - Added local `tmuxBaseName(project, session)` (replicates the server helper — no hash).
  - All 3 `create-terminal` fetch bodies now send `{ session, project }`.
  - `tmuxActive` now keys on `tmuxBaseName(sub.project, sub.session)` instead of bare `sub.session`.

## Verification
- `extensions/vscode` `tsc --noEmit`: **clean** (zero errors).
- `ui` `tsc --noEmit`: stash-diff over SubscriptionsPanel.tsx → **no new error categories**.
  The only 2 errors touching the file are pre-existing iframe-attribute (`scrolling`/`frameBorder`/
  `allowtransparency`) typings at lines 47/65, unrelated to this change.
- Semantic review: both files match the verified research plans.

## Wave TSC
- Extension: clean. UI: no new errors (48 pre-existing baseline unchanged).

## Post-execution (manual, NOT in task graph)
- Extension source changed but the running extension is the bundled `out/extension.js`.
  Rebuild + repackage required for it to take effect:
  `cd extensions/vscode && npm run compile` (and `vsce package` / bump `.vsix` to distribute).
- Kill any pre-existing plainly-named tmux sessions once (migration).
