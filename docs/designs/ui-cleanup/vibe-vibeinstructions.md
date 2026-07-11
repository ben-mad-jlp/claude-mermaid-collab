# Vibe: ui-cleanup

## Goal
Fix UI/UX bugs in the mermaid-collab desktop app — primarily the Bridge, the
sidebar, the Watching/subscribe surfaces, and the built-in browser.

## Context
Working in the desktop app (canonical server on :9002). Deploy model:
`npm run deploy` swaps sidecar + ui/dist; changes to `desktop/src/main` or
`desktop/src/preload` need a full `cd desktop && npm run dist:dir` rebuild +
reinstall to /Applications (see memory project_desktop_deploy_model).

Shipped this session (all pushed to origin/master):
- Bridge diagram per-project: `targetProject` is now a total field (defaulted on
  create + backfilled); FleetGraph filters to the active project.
- Unified project list: project registry ⟷ supervisor watched_project kept in
  lockstep; boot reconcile no longer re-floods the Bridge with every project.
  Watched set pruned to: claude-mermaid-collab, build123d-ocp-mcp, yolox-markup,
  stud_feeder, supervisor, steward.
- Watching subscribe modal: folds in WATCHED projects (sessionless ones show),
  sorted alphabetically, worker-<hash> sessions filtered out.
- Sidebar: "Other Sessions" scopes to the open session, not stale activeProject.
- Hook: desktop app is canonical server (server-check.sh prefers launching app).
- Built-in browser: browser_* tools now auto-open + focus the embedded pane
  (ensureSessionTab activates + fires mc:browser:session-ensured). Full rebuild.

Open loose end: version bump (5.85.12) pending — the tree wasn't clean (another
session's SupervisorPanel/CommandBar WIP). Bump once clean.

## Pair Mode
Disabled

## Agent Mode
Enabled
