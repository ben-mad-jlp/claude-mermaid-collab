# Design: Todos Upgrade + Cross-Session Assignment + Asana Sync

Research synthesis (codebase agent + Grok). Anticipates the planned **"managing session"** feature (a session that assigns work to other sessions). Local-first stays the source of truth; Asana is an optional cloud mirror.

## Current implementation (grounded)
- **Store:** per-session JSON at `<project>/.collab/sessions/<session>/session-todos.json` (`src/mcp/tools/session-todos.ts`). Already local-first/offline. (Repo-root `.collab/todos.json` is a legacy/unrelated artifact.)
- **Model** (`session-todos.ts:33`): `{ id: number (per-file nextId), text, completed: boolean, order (×10), createdAt, updatedAt, link?: { blueprintId, taskId? } }`.
- **Surface:** REST `/api/session-todos*` (`src/routes/api.ts:2519`), MCP tools (`setup.ts:3707`), each mutation broadcasts a **payload-less** `session_todos_updated` WS event (`websocket/handler.ts:54`) → clients re-fetch.
- **UI:** sidebar list — `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx` (current) + older `SessionTodosSection.tsx`. Toggle / inline-edit / delete / drag-reorder / show-completed / clear-completed / link chip. No board, columns, or assignee/status filtering.
- **Limitations vs goals:** binary status only; **per-file numeric id (not globally unique)**; no owner/assignee; no priority/due/description/subtasks/deps; no external-id/sync hooks; minimal viewing.

## Upgraded local model (both sources converge)
```ts
interface Todo {
  id: string;                 // UUID — global (replaces per-file number; keep numeric alias for migration)
  ownerSession: string;       // managing/creating session = source-of-truth anchor (never changes)
  assigneeSession?: string;   // worker session (null = unassigned) ← cross-session assignment
  title: string;              // (current `text`)
  description?: string;       // markdown → Asana notes
  status: 'backlog'|'todo'|'in_progress'|'blocked'|'done';  // replaces completed boolean
  completed: boolean;         // derived (status==='done') for back-compat + Asana mirror
  priority?: 0|1|2|3|4;       // P0–P4
  dueDate?: string;           // YYYY-MM-DD → Asana due_on
  parentId?: string;          // flat subtask hierarchy (NOT nested — easier sync/query)
  dependsOn?: string[];       // explicit blockers
  order: number;              // fractional indexing or ×10 gaps
  link?: { blueprintId: string; taskId?: string };  // existing
  createdAt: string; updatedAt: string; completedAt?: string;
  asana?: { gid?: string; lastSyncedAt?: string; dirty?: boolean; remoteModifiedAt?: string };
}
```
Grok's call (good): **flat `parentId` + `dependsOn`** beats nested subtasks for sync/query/Asana mapping. `ownerSession` is the immutable anchor.

## Cross-session storage — DECIDED: per-project store (Option A)

**Decision (locked):** a **single per-PROJECT todo store**, indexed by `ownerSession`/`assigneeSession`. The managing session queries/writes the project-wide set filtered by assignee — assignment is a plain query/write with **no merge/conflict layer**. Needs a per-project write mutex + a one-time migration from the per-session files.

Rationale (grounded in [[design-native-app]] topology): manager + worker sessions live **within one project** (typically one server), so a shared per-project store is sufficient and the existing payload-less `session_todos_updated` WS broadcast already refreshes all connected clients. The rejected alternative (per-session stores + broadcast-merge deltas, LWW + conflict log) is only needed for **cross-machine/cross-server** assignment — the unbuilt **federation** gap ([[design-remote-connectivity]]), explicitly out of scope.

**Storage tech:** a **`bun:sqlite` table** is the target (codebase already uses bun:sqlite widely; index owner/assignee/status/dueDate — fits the new filtered views). A richer-model JSON is an acceptable Phase-0 stopgap if we want to defer the SQLite migration, but SQLite is the intended home.

**Layout:** `<project>/.collab/todos.(db|json)` (project-scoped), replacing the per-session `sessions/<session>/session-todos.json` files (migrate existing into the project store, stamping `ownerSession` = the file's session).

## Managing-session mechanics (Option A)
- Manager creates todos with `ownerSession = self`, sets `assigneeSession = <worker>`. Worker's view = `assigneeSession === me`. Manager's view = `ownerSession === me` grouped by assignee.
- Broadcast must notify **both** owner and assignee sessions' clients (extend the WS event to carry/target both, or keep payload-less + clients re-query the project store).
- Cross-machine assignment ⇒ requires federation (deferred); document as a known boundary.

## Asana sync (optional mirror; local wins)
- **Auth:** start with a **Personal Access Token** (single-user); OAuth later for multi-user. Base `https://app.asana.com/api/1.0`.
- **Push (local→Asana):** outbox queue persisted to disk; on each local write enqueue create/update; flush when online; `POST/PUT /tasks`, subtasks via `/tasks/{parent}/subtasks`, section moves via `/sections/{gid}/addTask`. Store `asana.gid` on the todo.
- **Pull (Asana→local):** **Events API polling** (`GET /events?resource=&sync=token`), NOT webhooks — webhooks need a public HTTPS endpoint a local tool lacks (revisit if a tunnel exists). Caveats: sync token expires ~4h (poll < 4h or full-resync); 100 events/token.
- **Offline reconciliation:** local authoritative; `dirty` flag + `lastSyncedAt`; conflict policy = **local-wins LWW by `updatedAt`**, surface remote-only changes as "Asana override available" (don't auto-apply). Field-level merge is a nice-to-have, not v1.
- **Mapping (sessions aren't Asana users!):** project = the effort; **session → Asana *section*** (assignment = section move, a first-class event) **+ custom field** to record true `ownerSession`/`assigneeSession` and the **status enum** (Asana tasks are binary-complete; status needs a single-select custom field). Custom fields are paid-tier.
- **Limits:** 150 req/min free / 1500 paid; honor `429 Retry-After`; batch to avoid fan-out across many sessions.

## Viewing/filtering upgrade (cross-session world)
Views that matter: **Assigned to me** (worker default, grouped by status), **My managed work** (manager: by assignee), **Session overview** (group by assignee→status), **Kanban by status** (swimlanes by priority/assignee), **cross-session dashboard** (owner/assignee columns, filter by managing session). Filters: status, priority, overdue, blocked-by-deps, linked blueprint. Saved views per role (manager vs worker) are high-value.

## Phased plan (both agree)
- **Phase 0 (now):** upgraded local model + migration (UUID + owner/assignee even if initially self=self + status enum + priority/due/description + flat parentId/dependsOn) + the new views. Delivers ~70% of the perceived upgrade. Decide storage (Option A per-project store; SQLite vs JSON).
- **Phase 1:** cross-session assignment wired to the managing-session feature + real-time refresh + a simple conflict/activity log.
- **Phase 2:** Asana mirror — **push-only first**, then pull via Events API; outbox + local-wins.
- **Do NOT over-build:** no CRDTs, no nested mutable subtasks, no heavy conflict UI, no bidirectional Asana until push is solid.

## Migration / risk
- **id number→UUID** touches MCP schemas (`id: number`), REST `/:id` regex (`\d+`), UI `todo.id: number` + `#{id}` display → needs a migration + back-compat shim.
- Per-session→per-project store relocation needs a one-time migration (mutex key, broadcast targeting change).
- Cross-machine assignment = federation gap (out of scope).
- Asana: sessions≠users (sections/custom-fields), token expiry, paid-tier custom fields, rate-limit fan-out.

## Sources
Asana: [auth](https://developers.asana.com/docs/authentication), [PAT](https://developers.asana.com/docs/personal-access-token), [webhooks](https://developers.asana.com/docs/webhooks-guide), [events](https://developers.asana.com/reference/getevents), [rate limits](https://developers.asana.com/docs/rate-limits).
