## DiagramManager

Manages Mermaid diagram files (`.mmd`):

```typescript
class DiagramManager {
  private index: Map<string, DiagramMeta>;
  async initialize(): Promise<void>      // Scan and build index
  async listDiagrams(): Promise<DiagramListItem[]>
  async getDiagram(id: string): Promise<Diagram | null>
  async saveDiagram(id: string, content: string): Promise<void>
  async createDiagram(name: string, content: string): Promise<string>
}
```

## DocumentManager

Manages Markdown documents (`.md`) with same pattern as DiagramManager.

## SessionRegistry

Tracks collab sessions across projects in `~/.mermaid-collab/sessions.json`:

```typescript
interface Session {
  project: string;
  session: string;
  lastAccess: string;
}

class SessionRegistry {
  async load(): Promise<SessionRegistryData>
  async save(registry: SessionRegistryData): Promise<void>
  async register(project: string, session: string): Promise<void>
}
```

## CollabManager

Manages collaboration session state and phase transitions:

```typescript
type CollabPhase = 'brainstorming' | 'rough-draft/interface' | 
                   'rough-draft/pseudocode' | 'rough-draft/skeleton' | 
                   'implementation';

interface CollabState {
  phase: CollabPhase;
  template: CollabTemplate;
  lastActivity: string;
  pendingVerificationIssues: VerificationIssue[];
}
```

## UIManager

Handles render_ui blocking mode with Promise resolution:

```typescript
interface PendingUI {
  uiId: string;
  blocking: boolean;
  timeout: number;
  resolve: (response: UIResponse) => void;
}

class UIManager {
  async renderUI(request: RenderUIRequest): Promise<UIResponse>
  resolveUI(sessionKey: string, response: UIResponse): void
}
```

## TerminalManager

Persists terminal session state per collab session:

```typescript
class TerminalManager {
  async readSessions(project, session): Promise<TerminalSessionsState>
  async writeSessions(project, session, state): Promise<void>
  async createSession(project, session, name?): Promise<TerminalSession>
}
```

## KodexManager

Knowledge base with SQLite metadata + Markdown content:

```typescript
interface TopicContent {
  conceptual: string;  // Overview
  technical: string;   // Implementation details
  files: string;       // Related files
  related: string;     // Related topics
}

class KodexManager {
  // Topics
  async getTopic(name: string): Promise<Topic | null>
  async listTopics(): Promise<TopicMetadata[]>
  async createTopic(name, title, content): Promise<Draft>
  async updateTopic(name, content, reason): Promise<Draft>
  
  // Drafts & Approval
  async listDrafts(): Promise<Draft[]>
  async approveDraft(name: string): Promise<Topic>
  async rejectDraft(name: string): Promise<void>
  
  // Flags
  async createFlag(name, type, description): Promise<Flag>
  async listFlags(status?): Promise<Flag[]>
  
  // Analytics
  async getDashboardStats(): Promise<DashboardStats>
}
```