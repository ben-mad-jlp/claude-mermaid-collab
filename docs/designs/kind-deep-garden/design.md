# Session: kind-deep-garden

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Add session_created broadcast to backend
**Type:** code
**Status:** documented
**Problem/Goal:**
When a session is created, browsers don't know about it until they manually refresh. This causes render_ui to fail because the user can't select a session that doesn't appear in their list yet.

**Approach:**
1. Modify `SessionRegistry.register()` in `src/services/session-registry.ts`:
   - Change return type from `Promise<void>` to `Promise<{ created: boolean }>`
   - Return `{ created: true }` for new sessions, `{ created: false }` for existing

2. Add `session_created` to WSMessage in `src/websocket/handler.ts`:
   ```typescript
   | { type: 'session_created'; project: string; session: string }
   ```

3. Update all 3 call sites in `src/routes/api.ts` (lines 131, 218, 460):
   - Check return value of `register()`
   - Only broadcast `session_created` if `created === true`

**Success Criteria:**
- All connected browsers receive session_created WebSocket message when a NEW session is registered
- Existing sessions (idempotent register) do not trigger broadcast

**Decisions:**
- Broadcast from all places that call sessionRegistry.register(), not just POST /api/sessions
- Only broadcast for newly created sessions, not updates to existing sessions

---

### Item 2: Handle session_created in frontend
**Type:** code
**Status:** documented
**Problem/Goal:**
Frontend needs to react to session_created messages by refreshing the session list and auto-selecting the new session.

**Approach:**
Add `case 'session_created'` in `ui/src/App.tsx` WebSocket message handler (around line 291):

```typescript
case 'session_created': {
  const { project, session } = message as any;
  await loadSessions();
  const freshSessions = useSessionStore.getState().sessions;
  const newSession = freshSessions.find(s => s.project === project && s.session === session);
  if (newSession) {
    setCurrentSession(newSession);
  }
  break;
}
```

**Success Criteria:**
- When a session is created, browser automatically shows it in dropdown and selects it
- Uses API as source of truth (refetch rather than construct client-side)

**Decisions:**
- Refetch sessions from API rather than adding session directly to store
- Use `useSessionStore.getState().sessions` after await to get fresh data

---

### Item 3: Handle ui_render in frontend
**Type:** code
**Status:** documented
**Problem/Goal:**
ui_render WebSocket messages are broadcast but not handled by the frontend. The ChatDrawer has the infrastructure but no messages are being added to the store.

**Approach:**
Add `case 'ui_render'` in `ui/src/App.tsx` WebSocket message handler (around line 291):

```typescript
case 'ui_render': {
  const { uiId, project, session, ui, blocking, timestamp } = message as any;
  
  // Only process if message matches current session
  if (currentSession && 
      project === currentSession.project && 
      session === currentSession.name) {
    useChatStore.getState().addMessage({
      id: uiId,
      type: 'ui_render',
      ui,
      blocking: blocking ?? true,
      timestamp: timestamp || Date.now(),
      responded: false,
    });
  }
  break;
}
```

Also add import at top of file:
```typescript
import { useChatStore } from '@/stores/chatStore';
```

**Success Criteria:**
- ui_render messages appear in ChatDrawer when session matches
- Messages for other sessions are ignored

**Decisions:**
- Filter on both project AND session (not just session name)
- Use `useChatStore.getState().addMessage()` for direct store access

---

### Item 4: Update skills to use terminal prompts during session creation
**Type:** task
**Status:** documented
**Problem/Goal:**
During session creation, render_ui can't work because the browser doesn't have the session yet. Skills should use terminal prompts during this phase.

**Approach:**
1. Update `skills/collab/SKILL.md`:
   - Use terminal prompts for session selection/creation flow
   - Remove any render_ui examples from session management section

2. Update `skills/gather-session-goals/SKILL.md`:
   - Remove render_ui examples from the skill
   - Use terminal prompts for all user interactions
   - This skill runs immediately after session creation, before browser can receive session_created

**Success Criteria:**
- collab skill uses terminal prompts during session creation/selection
- gather-session-goals skill uses terminal prompts (no render_ui)
- render_ui only used after session is established and browser has it selected

**Decisions:**
- Terminal prompts during session creation phase (collab, gather-session-goals)
- render_ui allowed in later phases (brainstorming, rough-draft, etc.) after session is established

---

### Item 5: Enforce MCP-only file operations in collab skills
**Type:** code
**Status:** documented
**Problem/Goal:**
Collab/design skills should not create or edit files directly - only through MCP tools. This ensures consistency and proper session management. Only implementation skills should have direct file system access.

**Approach:**
Add `allowed-tools` frontmatter to skills that don't need file editing:

| Skill | allowed-tools |
|-------|---------------|
| collab-compact | `mcp__plugin_mermaid-collab_mermaid__*, Read` |
| dispatching-parallel-agents | `mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Task` |
| mermaid-collab | `mcp__plugin_mermaid-collab_mermaid__*, Read, Skill` |
| ready-to-implement | `mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep` |
| requesting-code-review | `mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep` |
| using-gui-wireframes | `mcp__plugin_mermaid-collab_mermaid__*, Read` |
| using-superpowers | `Read, Skill` |
| writing-plans | `mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep` |

**Skills left unrestricted (need file editing):**
- test-driven-development (writes code)
- writing-skills (writes skill files)
- receiving-code-review (implements feedback)
- finishing-a-development-branch (git operations)
- collab-cleanup (deletes session folders)

**Success Criteria:**
- All 8 design-phase skills have `allowed-tools` restrictions
- No design-phase skill can directly create/edit files outside MCP

**Decisions:**
- Design-phase skills get MCP + read-only tools (Read, Glob, Grep)
- Task/Skill tools added where needed for orchestration
- Implementation skills (TDD, writing-skills, etc.) remain unrestricted

---

## Interface

### Item 1: Backend session_created broadcast

**Files:**
- `src/services/session-registry.ts`
- `src/websocket/handler.ts`
- `src/routes/api.ts`

**Type Changes:**

```typescript
// src/services/session-registry.ts
// Change return type of register()
async register(project: string, session: string): Promise<{ created: boolean }>

// src/websocket/handler.ts
// Add to WSMessage union type
| { type: 'session_created'; project: string; session: string }
```

---

### Item 2: Frontend session_created handler

**Files:**
- `ui/src/App.tsx`

**No new types.** Adds case to existing switch statement.

---

### Item 3: Frontend ui_render handler

**Files:**
- `ui/src/App.tsx`

**No new types.** Adds case to existing switch statement and import.

---

### Item 4: Skills terminal prompts (Documentation)

**Files:**
- `skills/collab/SKILL.md`
- `skills/gather-session-goals/SKILL.md`

**No code interfaces.** Documentation changes only - remove render_ui examples.

---

### Item 5: Skill allowed-tools (Configuration)

**Files:**
- `skills/collab-compact/SKILL.md`
- `skills/dispatching-parallel-agents/SKILL.md`
- `skills/mermaid-collab/SKILL.md`
- `skills/ready-to-implement/SKILL.md`
- `skills/requesting-code-review/SKILL.md`
- `skills/using-gui-wireframes/SKILL.md`
- `skills/using-superpowers/SKILL.md`
- `skills/writing-plans/SKILL.md`

**No code interfaces.** Frontmatter changes only - add `allowed-tools` field.

---

## Pseudocode

### Item 1: Backend session_created broadcast

**SessionRegistry.register() changes:**
```
FUNCTION register(project, session):
  validate project is absolute path
  validate session is alphanumeric with hyphens
  
  registry = load()
  existingIndex = find session in registry
  
  IF existingIndex >= 0:
    update lastAccess
    save registry
    ensure directories exist
    RETURN { created: false }  # <-- NEW: was void
  ELSE:
    add new session to registry
    save registry
    ensure directories exist
    create collab-state.json if not exists
    create design.md if not exists
    RETURN { created: true }   # <-- NEW: was void
```

**api.ts POST /api/sessions:**
```
FUNCTION handlePostSessions(req, wsHandler):
  { project, session } = parse body
  result = await sessionRegistry.register(project, session)
  
  IF result.created:
    wsHandler.broadcast({ type: 'session_created', project, session })
  
  RETURN { success: true, project, session }
```

**api.ts POST /api/diagram (and similar for document):**
```
FUNCTION handlePostDiagram(req, wsHandler):
  params = getSessionParams(url)
  { name, content } = parse body
  
  result = await sessionRegistry.register(params.project, params.session)
  
  IF result.created:
    wsHandler.broadcast({ type: 'session_created', project: params.project, session: params.session })
  
  # ... rest of existing logic
```

---

### Item 2: Frontend session_created handler

```
CASE 'session_created':
  { project, session } = message
  
  await loadSessions()  # Refetch from API
  
  freshSessions = useSessionStore.getState().sessions
  newSession = find session where s.project == project AND s.session == session
  
  IF newSession:
    setCurrentSession(newSession)  # Auto-select
  
  BREAK
```

---

### Item 3: Frontend ui_render handler

```
CASE 'ui_render':
  { uiId, project, session, ui, blocking, timestamp } = message
  
  # Only process if matches current session
  IF currentSession AND
     project == currentSession.project AND
     session == currentSession.name:
    
    useChatStore.getState().addMessage({
      id: uiId,
      type: 'ui_render',
      ui: ui,
      blocking: blocking ?? true,
      timestamp: timestamp || Date.now(),
      responded: false
    })
  
  BREAK
```

---

### Item 4: Skills terminal prompts

**collab/SKILL.md:**
- Remove "Browser-Based Questions" section from session-mgmt.md
- Keep terminal-based flow for session selection/creation

**gather-session-goals/SKILL.md:**
- Remove "Browser-Based Questions" section entirely
- All user interactions use terminal prompts

---

### Item 5: Skill allowed-tools

**For each skill, add to frontmatter after `description:` line:**

```yaml
# collab-compact/SKILL.md
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read

# dispatching-parallel-agents/SKILL.md
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Task

# mermaid-collab/SKILL.md
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Skill

# ready-to-implement/SKILL.md
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep

# requesting-code-review/SKILL.md
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep

# using-gui-wireframes/SKILL.md
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read

# using-superpowers/SKILL.md
allowed-tools: Read, Skill

# writing-plans/SKILL.md
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep
```

---

## Skeleton

### Task Dependency Graph

```yaml
tasks:
  # Item 1: Backend changes (must complete before frontend can test)
  - id: backend-wstype
    files: [src/websocket/handler.ts]
    description: Add session_created to WSMessage type union
    parallel: true

  - id: backend-registry
    files: [src/services/session-registry.ts]
    description: Change register() return type to Promise<{ created: boolean }>
    parallel: true

  - id: backend-api
    files: [src/routes/api.ts]
    description: Update 3 call sites to broadcast session_created when created=true
    depends-on: [backend-wstype, backend-registry]

  # Item 2 & 3: Frontend changes (depend on backend for testing)
  - id: frontend-session-created
    files: [ui/src/App.tsx]
    description: Add case 'session_created' handler in WebSocket switch
    depends-on: [backend-api]

  - id: frontend-ui-render
    files: [ui/src/App.tsx]
    description: Add case 'ui_render' handler and useChatStore import
    parallel: true  # Can be done alongside session_created

  # Item 4: Skill documentation (independent)
  - id: skill-collab-prompts
    files: [skills/collab/SKILL.md, skills/collab/session-mgmt.md]
    description: Remove render_ui examples from session management
    parallel: true

  - id: skill-gather-goals-prompts
    files: [skills/gather-session-goals/SKILL.md]
    description: Remove Browser-Based Questions section
    parallel: true

  # Item 5: Skill allowed-tools (independent, can parallelize)
  - id: skill-allowed-tools-1
    files: [skills/collab-compact/SKILL.md, skills/dispatching-parallel-agents/SKILL.md]
    description: Add allowed-tools frontmatter
    parallel: true

  - id: skill-allowed-tools-2
    files: [skills/mermaid-collab/SKILL.md, skills/ready-to-implement/SKILL.md]
    description: Add allowed-tools frontmatter
    parallel: true

  - id: skill-allowed-tools-3
    files: [skills/requesting-code-review/SKILL.md, skills/using-gui-wireframes/SKILL.md]
    description: Add allowed-tools frontmatter
    parallel: true

  - id: skill-allowed-tools-4
    files: [skills/using-superpowers/SKILL.md, skills/writing-plans/SKILL.md]
    description: Add allowed-tools frontmatter
    parallel: true
```

### Execution Order

1. **Parallel batch 1** (independent):
   - backend-wstype
   - backend-registry
   - frontend-ui-render
   - skill-collab-prompts
   - skill-gather-goals-prompts
   - skill-allowed-tools-1
   - skill-allowed-tools-2
   - skill-allowed-tools-3
   - skill-allowed-tools-4

2. **Sequential** (after batch 1):
   - backend-api (depends on backend-wstype, backend-registry)

3. **Sequential** (after backend-api):
   - frontend-session-created (depends on backend-api for testing)

---

## Diagrams
(auto-synced)