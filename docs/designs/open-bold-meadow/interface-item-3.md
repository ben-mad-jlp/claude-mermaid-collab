# Interface: Item 3 - MCP Terminal Tools (includes Items 2 & 4)

## File Structure

### Backend (New Files)
- `src/mcp/tools/terminal-sessions.ts` - MCP tool implementations
- `src/services/terminal-manager.ts` - Terminal session business logic
- `src/types/terminal.ts` - Shared type definitions

### Backend (Modified Files)
- `src/mcp/server.ts` - Register new tools
- `src/routes/api.ts` - Add HTTP endpoints for UI

### Frontend (Modified Files)
- `ui/src/hooks/useTerminalTabs.ts` - Fetch from API instead of localStorage
- `ui/src/components/terminal/TerminalTabsContainer.tsx` - Remove cleanup logic
- `ui/src/lib/api.ts` - Add terminal API methods

### Storage
- `.collab/<session>/terminal-sessions.json` - Per-session terminal state

## Type Definitions

```typescript
// src/types/terminal.ts

export interface TerminalSession {
  id: string;              // Unique identifier (UUID)
  name: string;            // Display name (e.g., "Terminal 1")
  tmuxSession: string;     // tmux session name (e.g., "mc-open-bold-meadow-a1b2")
  created: string;         // ISO timestamp
  order: number;           // Tab order for UI
}

export interface TerminalSessionsState {
  sessions: TerminalSession[];
  lastModified: string;    // ISO timestamp
}

// MCP Tool Response Types
export interface CreateSessionResult {
  id: string;
  tmuxSession: string;
  wsUrl: string;
}

export interface ListSessionsResult {
  sessions: TerminalSession[];
}

export interface KillSessionResult {
  success: boolean;
}

export interface RenameSessionResult {
  success: boolean;
}

export interface ReorderSessionsResult {
  success: boolean;
}
```

## MCP Tool Signatures

```typescript
// src/mcp/tools/terminal-sessions.ts

/**
 * Create a new terminal session for a collab session
 */
export async function terminalCreateSession(
  project: string,
  session: string,
  name?: string
): Promise<CreateSessionResult>

/**
 * List all terminal sessions for a collab session
 */
export async function terminalListSessions(
  project: string,
  session: string
): Promise<ListSessionsResult>

/**
 * Kill a terminal session and its tmux process
 */
export async function terminalKillSession(
  project: string,
  session: string,
  id: string
): Promise<KillSessionResult>

/**
 * Rename a terminal session
 */
export async function terminalRenameSession(
  project: string,
  session: string,
  id: string,
  name: string
): Promise<RenameSessionResult>

/**
 * Reorder terminal sessions (for drag-and-drop)
 */
export async function terminalReorderSessions(
  project: string,
  session: string,
  orderedIds: string[]
): Promise<ReorderSessionsResult>
```

## Service Layer

```typescript
// src/services/terminal-manager.ts

export class TerminalManager {
  /**
   * Get storage path for terminal sessions
   */
  private getStoragePath(project: string, session: string): string

  /**
   * Read terminal sessions from storage
   */
  async readSessions(project: string, session: string): Promise<TerminalSessionsState>

  /**
   * Write terminal sessions to storage
   */
  async writeSessions(project: string, session: string, state: TerminalSessionsState): Promise<void>

  /**
   * Generate unique tmux session name
   */
  generateTmuxSessionName(collabSession: string): string

  /**
   * Create tmux session via shell
   */
  async createTmuxSession(tmuxSessionName: string): Promise<void>

  /**
   * Kill tmux session via shell
   */
  async killTmuxSession(tmuxSessionName: string): Promise<void>

  /**
   * List active tmux sessions matching prefix
   */
  async listActiveTmuxSessions(prefix: string): Promise<string[]>

  /**
   * Reconcile stored sessions with actual tmux sessions
   * Called on server startup
   */
  async reconcileSessions(project: string, session: string): Promise<void>
}
```

## HTTP API Endpoints

```typescript
// src/routes/api.ts

// GET /api/terminal/sessions?project=...&session=...
// Response: { sessions: TerminalSession[] }

// POST /api/terminal/sessions
// Body: { project, session, name? }
// Response: { id, tmuxSession, wsUrl }

// DELETE /api/terminal/sessions/:id?project=...&session=...
// Response: { success: boolean }

// PATCH /api/terminal/sessions/:id?project=...&session=...
// Body: { name }
// Response: { success: boolean }

// PUT /api/terminal/sessions/reorder?project=...&session=...
// Body: { orderedIds: string[] }
// Response: { success: boolean }
```

## Frontend API Client

```typescript
// ui/src/lib/api.ts

export interface ApiClient {
  // ... existing methods ...
  
  // Terminal session methods
  getTerminalSessions(project: string, session: string): Promise<TerminalSession[]>;
  createTerminalSession(project: string, session: string, name?: string): Promise<CreateSessionResult>;
  deleteTerminalSession(project: string, session: string, id: string): Promise<void>;
  renameTerminalSession(project: string, session: string, id: string, name: string): Promise<void>;
  reorderTerminalSessions(project: string, session: string, orderedIds: string[]): Promise<void>;
}
```

## Frontend Hook Changes

```typescript
// ui/src/hooks/useTerminalTabs.ts

export interface UseTerminalTabsOptions {
  project: string;
  session: string;
  // REMOVE: collabSessionId, storageKey, defaultPort, onSessionClose
}

export interface UseTerminalTabsReturn {
  tabs: TerminalSession[];
  activeTabId: string | null;
  activeTab: TerminalSession | null;
  isLoading: boolean;
  error: Error | null;
  addTab: () => Promise<void>;
  removeTab: (id: string) => Promise<void>;
  renameTab: (id: string, name: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Hook now fetches from API instead of localStorage
 * - On mount: fetch sessions from API
 * - On collab session change: refetch
 * - Operations call API then update local state
 */
export function useTerminalTabs(options: UseTerminalTabsOptions): UseTerminalTabsReturn
```

## Component Interactions

```
┌─────────────────────────────────────────────────────────────────┐
│                           Frontend                               │
├─────────────────────────────────────────────────────────────────┤
│  TerminalTabsContainer                                          │
│    └── useTerminalTabs(project, session)                        │
│          └── api.getTerminalSessions()                          │
│          └── api.createTerminalSession()                        │
│          └── api.deleteTerminalSession()                        │
│          └── api.renameTerminalSession()                        │
│          └── api.reorderTerminalSessions()                      │
│    └── TerminalTabBar                                           │
│    └── EmbeddedTerminal (for each session)                      │
│          └── iframe src={ttydUrl}?arg={tmuxSession}             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        HTTP API                                  │
├─────────────────────────────────────────────────────────────────┤
│  /api/terminal/sessions                                         │
│    └── GET: list sessions                                       │
│    └── POST: create session                                     │
│  /api/terminal/sessions/:id                                     │
│    └── DELETE: kill session                                     │
│    └── PATCH: rename session                                    │
│  /api/terminal/sessions/reorder                                 │
│    └── PUT: reorder sessions                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      TerminalManager                             │
├─────────────────────────────────────────────────────────────────┤
│  - Read/write .collab/<session>/terminal-sessions.json          │
│  - Create/kill tmux sessions via shell                          │
│  - Reconcile on startup                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     External Services                            │
├─────────────────────────────────────────────────────────────────┤
│  - tmux (session management)                                    │
│  - ttyd (terminal web UI)                                       │
│  - File system (.collab/ storage)                               │
└─────────────────────────────────────────────────────────────────┘
```

## MCP Tool Registration

```typescript
// src/mcp/server.ts

// Add to tool definitions:
{
  name: 'terminal_create_session',
  description: 'Create a new terminal session for a collab session',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to project' },
      session: { type: 'string', description: 'Collab session name' },
      name: { type: 'string', description: 'Optional display name' }
    },
    required: ['project', 'session']
  }
},
{
  name: 'terminal_list_sessions',
  description: 'List terminal sessions for a collab session',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to project' },
      session: { type: 'string', description: 'Collab session name' }
    },
    required: ['project', 'session']
  }
},
{
  name: 'terminal_kill_session',
  description: 'Kill a terminal session',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to project' },
      session: { type: 'string', description: 'Collab session name' },
      id: { type: 'string', description: 'Terminal session ID' }
    },
    required: ['project', 'session', 'id']
  }
},
{
  name: 'terminal_rename_session',
  description: 'Rename a terminal session',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to project' },
      session: { type: 'string', description: 'Collab session name' },
      id: { type: 'string', description: 'Terminal session ID' },
      name: { type: 'string', description: 'New display name' }
    },
    required: ['project', 'session', 'id', 'name']
  }
},
{
  name: 'terminal_reorder_sessions',
  description: 'Reorder terminal sessions',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to project' },
      session: { type: 'string', description: 'Collab session name' },
      orderedIds: { type: 'array', items: { type: 'string' }, description: 'Session IDs in new order' }
    },
    required: ['project', 'session', 'orderedIds']
  }
}
```
