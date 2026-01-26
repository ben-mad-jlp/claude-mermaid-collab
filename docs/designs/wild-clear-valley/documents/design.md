# Session: wild-clear-valley

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Persist project list in collab JSON file
**Type:** code
**Status:** documented
**Problem/Goal:**
Projects are currently only tracked through session folders. When sessions are deleted, we lose track of which projects have been used with collab/kodex.

**Approach:**
[PROPOSED] Create a new `ProjectRegistry` service that stores projects in `~/.mermaid-collab/projects.json`:

```typescript
interface Project {
  path: string;      // Absolute path (primary key)
  name: string;      // Display name (basename of path)
  lastAccess: string; // ISO timestamp for sorting
}
```

Auto-register projects when:
1. A session is created for the project
2. Kodex is accessed for the project (if `.collab/kodex/` exists)

The registry will check filesystem existence on list operations and auto-add discovered projects.

**Success Criteria:**
- Projects persist in `~/.mermaid-collab/projects.json`
- Creating a session auto-registers the project
- Accessing Kodex auto-registers if `.collab/kodex/` exists
- Projects sorted by lastAccess (most recent first)

**Decisions:**
- Separate file from sessions.json (cleaner separation)
- Name derived from path basename
- lastAccess updated on any project access

---

### Item 2: Add/remove projects functionality
**Type:** code
**Status:** documented
**Problem/Goal:**
Users need a way to manage the list of known projects - adding new ones and removing old ones.

**Approach:**
[PROPOSED] Expose project management via REST API, MCP tools, and UI button:

**REST API** (`src/routes/api.ts`):
- `GET /api/projects` - List all registered projects
- `POST /api/projects` - Register a project `{ path: string }`
- `DELETE /api/projects?path=...` - Unregister a project

**MCP Tools** (`src/mcp/tools/projects.ts`):
- `list_projects()` - Returns all projects
- `register_project({ path })` - Add a project
- `unregister_project({ path })` - Remove a project

**UI Button** (Kodex header, next to project dropdown):
- "+" button opens modal/prompt for project path input
- Similar pattern to "Create Session" button in collab Header
- Calls `POST /api/projects` on submit

Both backend interfaces call the `ProjectRegistry` service from Item 1.

**Success Criteria:**
- REST endpoints work for UI/MCP integration
- MCP tools work for Claude integration
- UI "Add Project" button in Kodex header
- Adding a project validates the path exists
- Removing a project does not delete files (just unregisters)

**Decisions:**
- Follow existing session API patterns
- MCP tools mirror REST endpoints
- Path validation on add (must exist and be absolute)
- UI button in Kodex header (like collab "Create Session")

---

### Item 3: Add project dropdown to Kodex GUI
**Type:** code
**Status:** documented
**Problem/Goal:**
Kodex GUI needs to allow selecting from available projects instead of being locked to a single project.

**Approach:**
[PROPOSED] Add project dropdown to Kodex header with independent state:

**New Store** (`ui/src/stores/kodexStore.ts`):
```typescript
interface KodexState {
  selectedProject: string | null;
  projects: Project[];
  setSelectedProject: (path: string | null) => void;
  setProjects: (projects: Project[]) => void;
}
```

**UI Components:**
1. **Project dropdown** in `KodexLayout.tsx` header (like collab session selector)
2. **"+" button** next to dropdown (from Item 2) to add projects
3. **Delete button** on each project row to remove

**Behavior:**
- On mount: Fetch projects from `GET /api/projects`
- Default selection: Use `sessionStore.currentSession.project` if available
- Selection change: Update `kodexStore.selectedProject` (independent of collab)
- All Kodex pages read from `kodexStore.selectedProject`

**Success Criteria:**
- Project dropdown appears in Kodex header
- Defaults to collab session's project when available
- Changing project doesn't affect collab session
- All Kodex pages use the selected project for API calls

**Decisions:**
- Separate `kodexStore` for Kodex-specific state
- Header placement (consistent with collab pattern)
- Independent selection (Kodex can view different project than collab)

---

## Diagrams
(auto-synced)
