# Bug Review

Scope: src/websocket/handler.ts, src/routes/ide-routes.ts, src/services/ide-state.ts, extensions/vscode/src/extension.ts, ui/src/components/layout/SubscriptionsPanel.tsx, src/services/tmux-naming.ts, src/services/__tests__/tmux-naming.test.ts

## Bugs Found

### [Important] Shell injection risk in tmux attach command (extension.ts:287)

**File:** `extensions/vscode/src/extension.ts` line 287

**What's wrong:** The tmux shell command interpolates `base` (which is `msg.tmuxSession ?? msg.session`) and `groupedName` (derived from `base`) directly into single-quoted shell strings:

```ts
const base = msg.tmuxSession ?? msg.session;
const groupedName = `vscode-collab-${base}`;
const cmd = `(tmux has-session -t '${groupedName}' 2>/dev/null || tmux new-session -d -s '${groupedName}' -t '${base}') && tmux attach-session -t '${groupedName}'`;
```

When `msg.tmuxSession` is present (new server), `base` is a `mc-{slug}-{slug}` string — all `[a-z0-9-]`, safe. When `msg.tmuxSession` is absent (old server fallback), `base = msg.session` which is the raw unvalidated session name. A session name containing a single quote (e.g. `it's`) breaks the shell command. This was a pre-existing issue, and the new fallback path (`?? msg.session`) keeps it alive.

**Fix:** Sanitize the fallback: `const base = msg.tmuxSession ?? msg.session.replace(/'/g, '');` or escape it properly.

**Severity:** Minor in practice (session names with single quotes are unusual), but the new `??` fallback is the only path where this surfaces.

---

### [Minor] `groupedSessionNames` map key changed with no read-site updates (extension.ts:288)

**File:** `extensions/vscode/src/extension.ts` line 288

**What's wrong:** The key was changed from `sessionHint` to `display` (the new terminal display name). There are no read sites for this map visible in the codebase, making it dead state. This isn't a new bug introduced here (the map was already apparently unused for reads), but the key change means any future code that tries to look up by old key won't find entries. Low risk currently, but the map accumulates entries per terminal creation and is never cleared.

**Severity:** Minor / maintenance hazard.

---

### [Minor] Duplicate `tmuxBaseName` definition in UI vs server

**File:** `ui/src/components/layout/SubscriptionsPanel.tsx` line 116–120

**What's wrong:** A local copy of `tmuxBaseName` is defined in the UI component file instead of importing from a shared module. The two implementations are currently identical, but they can drift if the server-side algorithm changes. No runtime bug today.

**Fix:** Extract to a shared utility or import from a shared location.

**Severity:** Minor / maintenance hazard.

---

## Non-Issues (verified correct)

- **Old-server degradation in extension:** When `project`/`tmuxSession` are absent (old server sends `ide_reattach`/`ide_open_terminal` without these fields), the extension correctly falls back: `terminalDisplayName(session, undefined)` → `session` (no middle-dot suffix); `base = msg.session`; dedup check uses plain session name matching old terminal names. Correct.
- **`sub.project` availability in UI:** `SubscribedSession.project` is `string` (non-optional), so `tmuxBaseName(sub.project, sub.session)` never receives undefined.
- **`project` validation in ide-routes:** The new `project` required check returns 400 when absent, which is correct since the UI always sends it. Old clients that omit `project` get a clear error rather than a silent malfunction.
- **WSMessage union shape:** `ide_open_terminal` union member requires `project` and `tmuxSession`; the extension reads them with `as string | undefined` so it handles old-server messages where those fields are absent.
- **`tmuxBaseName` collision safety:** The `mc-{slug(basename)}-{slug(session)}` scheme with slug stripping non-alphanumeric chars means no separator ambiguity between basename and session parts. The known same-basename collision is documented and accepted.
