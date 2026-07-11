# Vocab-3: `session` (durable) → `workspace` — Migration Plan

> Decision 45a0d906 (spec-canonical-vocabulary). Epic: Vocab (1f75ebe9). Design todo: 142824b0.
> Winner strategy: **clean-break**, grafted per judge verdict. Right-sized for local-first single-user with repo-coordinated skills.

## 1. GOAL

`session` is overloaded: it means BOTH the durable `(project, name)` namespace that owns artifacts/todos on disk under `.collab/sessions/<name>/`, AND a live Claude runtime. This rename makes the durable namespace **`workspace`** everywhere it matters — on disk, in store columns, in internal types/vars, on the HTTP wire, in MCP tool names + params, and in the UI — while `session` is reserved for **the live runtime only**.

**Acceptance rule (the guard-grep that proves the cut landed):**
> After this lands, `session` on any wire / disk path / store column means a **live Claude runtime** — never a durable namespace.

This is a **single versioned commit + `npm version minor`**, NOT a phased alias window. One repo ships server + skills + UI together for one user; there is no external observer to protect. No HTTP aliases, no MCP alias `case`s, no `?? args.session` fallbacks, no Phase-C teardown debt. The one real hazard — a live MCP client holding a stale tool list — is resolved by the server restart that the version bump forces (client refetches the tool list on reconnect).

## 2. SCOPE — rename vs keep, per layer

### RENAME → `workspace`

| Layer | Change |
|---|---|
| **Disk** | `.collab/sessions/<name>/` → `.collab/workspaces/<name>/` (7 subdirs + `collab-state.json` + `metadata.json` ride along). `~/.mermaid-collab/sessions.json` → `workspaces.json`, inner field `session` → `workspace`. |
| **Store (SQLite)** | `todos` columns `ownerSession`→`ownerWorkspace`, `assigneeSession`→`assigneeWorkspace`, `sessionName`→`workspaceName`; indexes `idx_todos_owner`/`idx_todos_assignee` rebuilt on new columns. Durable `supervisor-store` columns likewise. |
| **HTTP routes** | `/api/sessions`(+`/archive`)→`/api/workspaces`; `/api/session-todos*`→`/api/workspace-todos*`; `/api/session-state*`→`/api/workspace-state*`; `?session=`→`?workspace=` (api/browser/ide/supervisor routes). Clean break — only the in-repo UI consumes these. |
| **MCP tool names (15 durable)** | `list_workspaces`, `archive_workspace`, `clear_workspace_artifacts`, `generate_workspace_name`, `generate_workspace_summary`, `validate_workspace_links`, `list_workspace_todos`, `add_workspace_todo`, `update_workspace_todo`, `toggle_workspace_todo`, `remove_workspace_todo`, `clear_completed_workspace_todos`, `reorder_workspace_todos`, `assign_workspace_todo`, `roadmap_spawn_workspace`. |
| **MCP param** | `session:` schema prop → `workspace:` on all ~22 durable artifact defs; each inline `const { project, session } = args as {...}` destructure → `workspace`. |
| **Internal types/vars** | `CollabSession`→`CollabWorkspace`, `getSessionsDir`→`getWorkspacesDir`, `listCollabSessions`→`listCollabWorkspaces`, local `session` params on durable code paths → `workspace`. |
| **UI** | `ui/src/stores/sessionStore.ts`→`workspaceStore.ts` + `subscriptionStore`/`chatStore`/`supervisorStore` durable refs; `SessionPanel`/`SessionCard`/`SessionInfo`→`Workspace*` (~30 components); fetch fields → `workspace`/`/api/workspaces`. |
| **Skills (in-repo)** | `skills/{collab,collab-todo,vibe-checkpoint,vibe-go,vibe-review,vibe-active,planner,steward,executing-plans-bugreview,ui-question}/SKILL.md` durable verbs/params → `workspace`. |

### KEEP `session` (runtime — already correct; final guard-grep allowlist)

- **MCP:** `register_claude_session`, `supervisor_clear_session`
- **HTTP:** `/api/claude-session/*`, `/api/session-notify`, `/api/session-status`, `/api/session-runtime`, `/api/session/context-update`, `/api/terminal/sessions`
- **Disk/DB:** `.collab/session-status.db`, `.collab/agent-sessions/`
- **Source:** `session-runtime.ts`, `lane-session-register.ts`, `cdp-session.ts`
- **Sibling dir:** `.collab/todos/<name>/` keeps its name (already correctly named; `<name>` is the workspace key as data, not a `session` dir literal).

### ALIAS

**None.** No HTTP alias, no MCP alias, no param fallback, no response mirroring, no Phase-C teardown. Single-user + repo-coordinated skills + restart-forces-refetch make every compat shim pure dead weight.

## 3. THE DATA MIGRATION (on-boot, idempotent, reversible, single-user)

New module `src/services/workspace-migration.ts` (template: `src/services/roadmap-migration.ts`). Called **once at server boot**, awaited, before any route/registry/MCP handler binds. Loops every registered project root (`collectProjectRoots()`).

```
migrateSessionsToWorkspaces(homeDir, projectRoots):
  for project in projectRoots:
    old = project/.collab/sessions      new = project/.collab/workspaces
    if exists(new): continue                         # idempotent — already migrated
    if not exists(old): continue                     # fresh install — nothing to do
    cp -R project/.collab  project/.collab.bak-vocab3-<ts>   # reversible backup (unless MERMAID_NO_BACKUP)
    fs.renameSync(old, new)                          # atomic same-fs move; contents untouched
    write new/.vocab3-migrated  { v:3, at, from:'sessions' }   # diagnostic breadcrumb

  # Registry file
  oldReg = homeDir/sessions.json   newReg = homeDir/workspaces.json
  if exists(newReg): skip
  else if exists(oldReg):
     data = read(oldReg)
     write(newReg, { workspaces: data.sessions.map(s => ({ project:s.project, workspace:s.session, lastAccess:s.lastAccess })) })
     rename(oldReg, oldReg + '.pre-workspace.bak')

  # todos.db columns — in todo-store open path, guarded by PRAGMA table_info
  if 'ownerWorkspace' NOT in table_info(todos):        # idempotent guard
     BEGIN;
     ALTER TABLE todos RENAME COLUMN ownerSession    TO ownerWorkspace;
     ALTER TABLE todos RENAME COLUMN assigneeSession TO assigneeWorkspace;
     ALTER TABLE todos RENAME COLUMN sessionName     TO workspaceName;
     DROP INDEX idx_todos_owner;    CREATE INDEX idx_todos_owner    ON todos(ownerWorkspace);
     DROP INDEX idx_todos_assignee; CREATE INDEX idx_todos_assignee ON todos(assigneeWorkspace);
     COMMIT;
```

**Idempotent:** every step guards on the post-state (`exists(workspaces/)` / column present). Re-boot is a no-op.
**Reversible:** the `.collab.bak-vocab3-<ts>` snapshot (cheap — one user); the dir rename reverses with `mv workspaces sessions`; the registry keeps `.pre-workspace.bak`; `ALTER ... RENAME COLUMN` (Bun SQLite ≥3.25) reverses by inverse ALTER. `MERMAID_NO_BACKUP=1` escape for CI.
**Single-user-right-sized:** server is down during the version-bump restart, so no online/lock/zero-downtime concern. One `rename()` + one JSON map + one transaction. Milliseconds.

**Dual-read fallback — RETAINED for this release (graft from disk-first, do NOT drop per pure clean-break).** Extend the existing detection at `session-registry.ts:353-373` so durable reads resolve `.collab/workspaces/` **first**, then `.collab/sessions/` as a read-only legacy fallback. `discoverDiskSessions` (`~:503+`) scans `workspaces/` first, `sessions/` second. This is the belt-and-suspenders for a project root not registered at boot (migration skipped) or an interrupted move. The pre-existing flat `.collab/<name>` fallback may be dropped — it is a prior, fully-applied migration.

## 4. BACK-COMPAT + ALIAS LIFETIME

**By design: none.** That is the point of the clean break for a single-user, repo-coordinated system.

- **In-repo skills (10 files):** updated to `workspace_*` names/params in the same commit. Zero gap.
- **In-repo UI:** updated same commit, lockstep with HTTP. Zero gap.
- **On-disk data:** migrated atomically on first boot; `.collab/sessions/` read-fallback covers an interrupted/skipped migration for one release.
- **A live/cached external MCP client** holding the pre-bump tool list: calling `add_session_todo` after the cut gets "unknown tool"; `session:` param gets ignored. **Mitigation:** the version bump restarts the server → connected clients refetch the tool list on reconnect → they see only `workspace_*`. For one user this is the normal "restart your Claude session" post-update flow.

**Alias lifetime: zero.** No alias ships, so none needs scheduled removal — no Phase-C debt, the single largest advantage over the phased alternatives.

## 5. EXACT SAFE SEQUENCE (each step `tsc`-clean + tests green + independently verifiable)

Ordered so each lower layer is canonical before the layer above consumes it; the public wire is never in a broken intermediate state within a commit.

1. **Chokepoint refactor — MANDATORY FIX.** `session-registry.ts` has **multiple hardcoded `join(project,'.collab','sessions',...)` literals that bypass `getSessionsDir`** — at lines ~271, ~514, ~558, ~591 (plus creation at ~270 and dual-read at ~355). Route **ALL** of them through `getWorkspacesDir()` (still returning `sessions/` at this step — no behavior change). Audit the few literal-`sessions` readers flagged in grounding (`snippet/metadata/terminal/update-log/browser-setups/project-registry`); most already route through the chokepoint. *Verify:* `tsc` clean; full `test:ci`; boot, create a workspace, confirm artifacts land where they always did.
2. **Add `workspace-migration.ts` + wire into boot + dual-read fallback** (chokepoint still returns `sessions/`, so migration is dormant). Unit-test in isolation against a temp `.collab/sessions/` fixture: run twice → idempotent; restore `.bak` → reversible. *Verify:* migration unit test passes.
3. **Flip path-builder + creation to `workspaces`** (`getWorkspacesDir` returns `.collab/workspaces`; sentinel-skip literals `'sessions'`→include `'workspaces'`) + registry → `workspaces.json`. Migration is now live. *Verify:* boot against a copy of real `.collab` (post-backup) → `workspaces/` exists, `sessions/` gone, breadcrumb written, `list_*` returns the same set; re-boot = no-op.
4. **Store column rename + the response-field mapper (graft from disk-first/internal-only).** Rename columns + indexes + the ~69 internal refs + TS interface fields in `todo-store.ts` (and durable `supervisor-store.ts`). Add a single serialization chokepoint `toApiTodo(row)` so the column→JSON-key mapping lives in ONE function — even in a clean break this localizes the wire-shape decision and makes the migration auditable by golden-file diff. *Verify:* `test:ci -- todo-store`; migrate a copy of real `todos.db`, assert rows preserved + idempotent on second boot; golden-file diff of the response shape.
5. **HTTP routes + `?workspace=`** across `api.ts` (+ browser/ide/supervisor/artifact). Durable only; runtime routes untouched; responses via `toApiTodo`. *Verify:* `tsc`; route tests hit `/api/workspaces*` + `?workspace=`.
6. **MCP `setup.ts`** — rename the 15 durable `case` labels in the `switch(name)` (~line 2446), the ~22 `session:{type:'string'}` schema props → `workspace:`, and every inline `const { project, session } = args` destructure in those case bodies → `workspace`. Runtime verbs (`register_claude_session`, `supervisor_clear_session`) untouched. *Verify:* `tsc`; MCP dispatch tests; fresh client sees only `*_workspace_*`.
7. **UI** — `sessionStore`→`workspaceStore` + ~30 components + fetch fields. (Bun-managed — never `npm install` in `ui/`.) *Verify:* `test:ci` (UI); boot app, smoke the workspace panel.
8. **Skills (10)** — durable verb names + `workspace:` params. *Verify:* grep `skills/` for `_session_`/`session:` → only runtime hits remain.
9. **Final guard-grep + version bump.** `grep -rn` durable-`session` across `src/ ui/ skills/` returns ONLY the §2 KEEP runtime allowlist. Then `npm version minor` (per CLAUDE.md — syncs plugin.json/marketplace.json/server.ts + tags). `git push && git push --tags`.

## 6. TECHNICAL PLAN — real files / fns / columns

**REUSE:**
- `src/services/collab-manager.ts:102-105` — the single dir chokepoint `getSessionsDir`→`getWorkspacesDir`, literal `'sessions'`→`'workspaces'`; sentinel-skip literals at 105/121/137/156/198/222.
- `src/services/roadmap-migration.ts` — structural template for `workspace-migration.ts` (boot-time, awaited, guarded).
- `src/services/session-registry.ts:353-373` dual-location idiom + `discoverDiskSessions` (~503+) — extend to `workspacesPath || sessionsPath`. **Fix the bypass literals at ~270/271/355/514/558/591 to route through the chokepoint.**
- `src/services/todo-store.ts:164-216` — `addColumnIfMissing`/`PRAGMA table_info` guard pattern for the `RENAME COLUMN` migration.
- `src/mcp/setup.ts:2446` `switch(name)` — rename case labels (no alias labels added).

**NEW:**
- `src/services/workspace-migration.ts` (§3 routine: dir rename + `.bak` + `workspaces.json` map + DB column rename) + its boot call site in `server.ts` (after project-registry load, before handlers bind) + unit test.
- `toApiTodo(row)` serializer in `todo-store.ts` — the single JSON-shape chokepoint.

**Files by step:** S1 `session-registry.ts` (+chokepoint readers); S2 new `workspace-migration.ts`, `server.ts` boot; S3 `collab-manager.ts`, registry shape; S4 `todo-store.ts` (cols `ownerSession`/`assigneeSession`/`sessionName` lines ~26/27/44/166/196-197 + `toApiTodo`), `supervisor-store.ts`; S5 `routes/{api,browser-routes,ide-routes,supervisor-routes,artifact-api}.ts`; S6 `mcp/setup.ts`; S7 `ui/src/stores/sessionStore.ts`+stores+components; S8 `skills/*/SKILL.md`.

## 7. WHY THIS OVER ALTERNATIVES

- **vs internal-only / additive-canonical (keep `session` on the wire):** rejected — keeping `session` as the durable MCP/HTTP/param vocabulary forever leaves the overload alive in the exact place agents and skills touch, making the rename cosmetic and failing decision 45a0d906. There is no external HTTP consumer to protect (UI is in-repo) and skills are repo-coordinated, so the public surface can and must move.
- **vs alias-window / disk-first phased:** rejected the HTTP route aliasing + response mirroring (no external HTTP consumer → buys nothing) and the MCP alias window + Phase-C teardown (a single-user version-bump restart forces the tool-list refetch, so the alias is nearly inert and only creates removal debt that rots into a permanent half-rename).
- **Grafted in anyway:** the idempotent+reversible boot migration with `.bak` (the only irreversible-by-default surface — disk + DB); the one-release dual-read fallback (cheap insurance against a skipped/interrupted migration); the `toApiTodo` serialization chokepoint (localizes + audits the wire-shape change); and the explicit runtime-`session` allowlist as the final guard-grep gate.

## 8. TOP RISKS + ROLLBACK

1. **Stranded reads from a bypassed path literal (HIGHEST).** `session-registry.ts` hardcodes `'sessions'` in several spots that skip the chokepoint; miss one and that read points at the now-empty old dir. *Mitigation:* Step 1 routes ALL literals through `getWorkspacesDir` before the flip; dual-read fallback + the guard-grep at Step 9 catch stragglers. *Rollback:* steps 1-2 are pure-internal git revert.
2. **DB migration corruption / partial ALTER.** *Mitigation:* single transaction, `PRAGMA`-guarded idempotency, `.collab.bak` snapshot taken before any boot mutation. *Rollback:* restore `.collab.bak-vocab3-<ts>`.
3. **Live external MCP client mid-session sees "unknown tool".** *Mitigation/accepted:* version-bump restart forces reconnect + tool-list refetch; normal single-user post-update flow.
4. **Interrupted dir rename (both `sessions/` and `workspaces/` exist).** *Mitigation:* merge branch (move only `<name>`s absent from target; never overwrite) + dual-read fallback. *Rollback:* `.bak` restore.

**Global rollback:** `git revert` the commit + `mv .collab.bak-vocab3-<ts> .collab` per project + restore `workspaces.json.pre-workspace.bak`. Single machine, single user — bounded and fast.
