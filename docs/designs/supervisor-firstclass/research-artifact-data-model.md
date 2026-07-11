# Artifact Data Model & Access Paths (ground truth)

Research for designing a PROJECT-scoped artifact view. ArtifactTree is currently session-scoped.

## 1. ON-DISK LAYOUT — artifacts are stored per-SESSION; no project-level artifact store

Artifacts live entirely under a session folder. The session registry creates the layout on register:

- `src/services/session-registry.ts:271-278` — `register()` mkdirs `<project>/.collab/sessions/<session>/{diagrams,documents,designs,spreadsheets,snippets,images,code-files}/`.
- `resolvePath()` (`session-registry.ts:421-452`) resolves an artifact folder for a `(project, session, type)` tuple. It probes three locations in order: new `.collab/sessions/<session>/<type>`, todos-session `.collab/todos/<session>/<type>`, legacy `.collab/<session>/<type>`. Type ∈ diagrams|documents|designs|spreadsheets|snippets|embeds|images|code-files.
- Per-artifact disk shape: `src/services/artifact-manager.ts:36-54` — `{basePath}/{id}.{ext}` + `.history/{id}.history` + sidecar `.{id}.meta.json` (stores original `name`). Extensions: `artifact-api.ts:20-27` (.mmd/.md/.snippet/.design.json/.spreadsheet/.embed.json).

There is **NO project-level artifact directory**. The only project-level (`.collab/`-root, not under a session) stores are the SQLite DBs in §2. Artifacts themselves are always under a `<session>/` folder.

## 2. DB / INDEX — artifacts are NOT in any DB; only an in-memory per-session index

- Artifacts have **no SQLite table and no persistent index**. Each `ArtifactManager` builds an in-memory `Map<id, {name, path, lastModified}>` by scanning its session folder at `initialize()` (`artifact-manager.ts:45,60-99`). That index is per-manager-instance (per `(project,session,type)`), not shared or queryable across sessions.
- Artifact metadata (deprecated/pinned/locked/blueprint flags) is held by a `MetadataManager` (referenced in `api.ts:1403-1405`), also session-scoped (JSON sidecar/metadata per session).
- The only SQLite DBs are **project-level** and DO NOT hold artifacts:
  - Todos: `src/services/todo-store.ts:162` → `<project>/.collab/todos.db`, table `todos` (DDL `todo-store.ts:119-150`). No `project` column (project = the DB path); rows carry `ownerSession`, `assigneeSession`, `sessionName` (`todo-store.ts:120-145`).
  - Supervisor/roadmap state via `supervisor-store.ts` / `roadmap-store.ts` (also project-keyed DBs under `.collab`).
- So no artifact row carries a `project` or `session` field — artifacts are identified purely by their on-disk path `<project>/.collab/sessions/<session>/<type>/<id>.<ext>`. The session (and project) is implicit in the path, never an indexed column.

## 3. SESSION → PROJECT MAPPING — explicit registry keyed by (project, session)

- Registry file: `~/.mermaid-collab/sessions.json` (`session-registry.ts:16-17`), array of `{ project, session, lastAccess }` (`session-registry.ts:6-10`).
- `sessionRegistry.list()` (`session-registry.ts:328-415`) returns all `{project, session, lastAccess}` rows (validating each folder still exists, auto-pruning stale).
- HTTP: `GET /api/sessions` (`api.ts:206-221`) returns `{ sessions }` and supports an **optional `?project=` filter** (`api.ts:211-212`) — so **enumerating all sessions for a given project is already cheap**: one `sessionRegistry.list()` + filter by `project`.

## 4. EXISTING LIST APIs — all artifact lists are (project + session)-scoped; none aggregate by project

- `GET /api/diagrams?project=&session=` (`api.ts:723-724`) and `GET /api/documents?project=&session=` (`api.ts:1396-1406`). Each calls `createManagers(project, session)` then `manager.list*()` over that one session's folder. Same pattern for designs/spreadsheets/snippets/images/embeds.
- `getSessionParams(url)` requires BOTH project and session or 400s (`api.ts:1398-1401`).
- MCP tools (`list_documents`, `list_diagrams`, `list_designs`, …) likewise take `project` + `session`.
- Generic `src/routes/artifact-api.ts` (`/exists`,`/register`,`/notify`) is also per `(project, session, type, id)` (`artifact-api.ts:60-92`).
- **There is NO endpoint that lists artifacts across all sessions of a project, nor any project-level aggregate.** Artifact APIs have no concept of project-without-session.

## 5. FRONTEND — ArtifactTree renders the CURRENT session's artifacts from sessionStore

- `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx:121-128` reads `diagrams/documents/designs/spreadsheets/snippets/embeds/images` directly off `useSessionStore` (the single "current session" store). It does not fetch; it just renders store slices into sections.
- The store is populated per-session by the data loader: `ui/src/lib/data-loader.ts:86-148` (`loadDiagrams`/`loadDocuments`/…) each call `api.getDiagrams(serverId, project, session)` etc. and write `useSessionStore.getState().setDiagrams(...)`. Driven on session change by `ui/src/hooks/useDataLoader.ts:134-135`.
- Keying: everything is keyed by the **single current session** (`currentSession.project`, `currentSession.name`) — see `ArtifactTree.tsx:486` (`${project}::${name}` for search cache) and §1 scope-mismatch banner at `ArtifactTree.tsx:506-520,965-989`, which already acknowledges the tree is "inherently session-scoped" and shows a hint when `uiStore.activeProject` differs from the current session's project.

## 6. SUPERVISOR ROUTES — how project-scoped todos aggregate (the template)

`GET /api/supervisor/todos?project=` (`src/routes/supervisor-routes.ts:102-113`):
```
return Response.json({ todos: listTodos(project, { includeCompleted }) });
```
The aggregation is **trivial because the data is already project-level**: `todos.db` is one DB per project (`todo-store.ts:162`), and `listTodos(project)` with NO session filter returns every row across all sessions (`todo-store.ts:241-260`; the `filter.session` branch is simply omitted). Each row self-identifies its session via `ownerSession`/`sessionName`, so the UI can group by session. No fan-out, no per-session iteration — one indexed SQL query.

**Contrast for artifacts:** there is no equivalent single store. Aggregating artifacts across a project requires fan-out: enumerate sessions (`sessionRegistry.list()` filtered by project, §3) then for each session instantiate managers / call the per-session list API and scan that session's folder (§1, §4).

## Implications for project-scoped artifacts

A project-scoped artifact view CANNOT reuse the todos trick directly, because (unlike todos) artifacts have no project-level DB — they are loose files under per-session folders with only in-memory per-session indexes. Realistic options seen in the code:

1. **Backend fan-out endpoint (closest to the todos template).** Add `GET /api/supervisor/artifacts?project=` (or `/api/project-artifacts`). Implementation: `sessionRegistry.list()` → filter by `project` (§3) → for each session, run the existing per-session manager `list*()` calls (the same code `/api/diagrams` etc. already use via `createManagers`) → merge, tagging each artifact with its `session`. Cheapest path that reuses all existing managers; cost = O(sessions × types) folder scans. Mitigate by caching/`ArtifactManager` index reuse. This is the most faithful analogue to §6 given there is no shared store.

2. **Frontend fan-out.** Have the UI call `GET /api/sessions?project=` then loop `api.getDiagrams/getDocuments/...` per session and merge into a new project-scoped store slice (parallel to sessionStore). No backend change, but N×types round-trips and the artifact endpoints currently demand both project+session (which is satisfied here). The existing `ArtifactTree` would need a project-scoped data source instead of `useSessionStore` (today it is hard-wired to the single current session, §5), so expect a new store/selector layer either way.

3. **Introduce a project-level artifact index/DB (larger).** Mirror `todos.db`: a `<project>/.collab/artifacts.db` index populated by the session-artifact-watcher (`src/services/session-artifact-watcher.ts`, which already watches session folders) carrying `(id, session, type, name, deprecated, pinned, lastModified, path)`. Then a project query is one SQL statement like todos. Biggest change but gives the same cheap aggregation and lets the artifact row finally carry a `session` (and implicit project) column — which today does not exist anywhere (§2).

**Bottom line:** No project-level artifact concept exists today; artifacts are session-scoped files with no project/session columns. The cheapest near-term aggregation path is option 1 (a backend fan-out over `sessionRegistry.list()` filtered by project, reusing the existing per-session managers), tagging each returned artifact with its session — structurally parallel to `/api/supervisor/todos` but doing fan-out instead of a single query. A project-level index (option 3) is the only way to match the todos query cheaply, and would also be where a real `session`/`project` artifact field would live.
