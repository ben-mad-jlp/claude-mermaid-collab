# Vibe: supervisor

## Goal
Build a "supervisor": a Claude session that monitors collab sessions, nudges idle ones (waiting + open todos) to continue, and escalates to the user. Extended to a SINGLE GLOBAL supervisor across machines via the desktop cross-machine router. Now also: ship the desktop app as an installable build and make the supervisor UX actually usable.

## Context
- supervisor-federation (W1–W4) shipped earlier on master (278428c, 8dc1410). One remaining manual gate: cross-machine smoke (needs desktop + 2nd machine).
- This session pivoted to desktop-app productization + bug fixes + supervisor UX. Plugin released at v5.74.1 (last pushed commit 4e6094d). Several commits since then are LOCAL-ONLY (not pushed).
- electron-agent-bridge was EXTRACTED to its own repo: ~/Code/electron-agent-bridge (private GitHub: ben-mad-jlp/electron-agent-bridge, main). mermaid-collab consumes it via `file:../electron-agent-bridge` + bare imports.
- Installed app lives at /Applications/Mermaid Collab.app (built via `cd desktop && CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:dir` then cp dist/mac-arm64/*.app to /Applications). Runs its own sidecar (mc-server) on :9002, proxy on fixed 9180.

## Pair Mode
Disabled

## Agent Mode
Enabled

## Currently Doing
- **All 3 session todos done this session** (auto-assign todos, supervisor-ui-doesn't-work, different-items-ui). Working on the supervisor app/UX.
- **Shipped + committed locally on master (NOT pushed yet; last push = 4e6094d):**
  - `457407e` terminal keep-alive (tabs stacked, visibility-hidden; fixes jumble on tab switch).
  - `4e6094d` cdp-session static import (sidecar bundling) — PUSHED.
  - `6e16e64` terminal attaches directly to base tmux session (drop vscode-collab grouping; -d sole client) — VSCode is deprecated, only does diffs now.
  - `9073e6a` lazy/optional electron-agent-bridge load.
  - `a768e26` todos default assigneeSession = ownerSession (createTodo).
  - `acd1192` Start-supervisor button fixed: invokeOnServer resolves 'local'→local server; SUPERVISOR_PROJECT default = ~/.mermaid-collab/supervisor (auto-mkdir); launchAndBind polls pane for ready marker then sends /collab (verify+retry) then /supervisor; SupervisorPanel passes allowedTools.
  - `eaf7faf` SupervisorPanel reworked SESSION-CENTRIC: lists supervised sessions (GET /api/supervisor/supervised) grouped by project w/ live status+avatar+lock+escalation; liveStatus matches project+session across subscriptions (serverId-agnostic); supervisorStore gained `supervised`+`loadSupervised`. VERIFIED live in installed app.
- **Also fixed earlier this session (committed/pushed in 16f38b8, etc.):** stable proxy port 9180 (was random → wiped localStorage each restart); blank new browser tabs (about:blank); browser native-view zoom-bounds (spilled into terminal at !=100% zoom); modal-behind-browser z-order; browser tab overflow; artifact-viewer toggle + highlighted pane toggles + per-server recheck + layout persistence; typecheck cleanup (92→0); browser DevTools button.
- **NEXT / OPEN:**
  - Decide: PUSH the local commits (457407e, 6e16e64, 9073e6a, a768e26, acd1192, eaf7faf) and BUMP version (patch → 5.74.2)? Not pushed/bumped yet.
  - Desktop bundle CFBundleShortVersionString syncs to plugin version now (version:sync hook updated), but the INSTALLED app still shows whatever it was built with — rebuild+reinstall to refresh.
  - Cross-machine federation smoke still unverified (needs 2nd machine).
  - VSCode is deprecated: only `/api/ide/open-diff` should remain — broader cleanup of dead IDE/vscode integration is a pending option the user raised.
  - `handler.ts` had an in-progress edit adding `previousAssigneeSession` to session_todos_updated (user/linter; left untouched).
- **Gotchas:** installed app process name is "Mermaid Collab" (not "Electron") for osascript window queries; kill stale instances + rm ~/Library/Application Support/mermaid-collab-desktop/Singleton* before relaunch (single-instance lock blocks dev app); CDP discovery file at ~/.mermaid-collab/electron-cdp.json.

**Open todos:**
- #298e38a2 VERIFY-reassign-fix demo todo (assignee: bugfixes) — looks like a leftover test todo; likely safe to delete.
