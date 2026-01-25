# Implementation Skeleton

## Task Dependencies

```
Phase 1 (Foundation):
  T1: Update session paths → T2
  T2: Create KodexManager

Phase 2 (Backend) - Can run in parallel:
  T3: Add Kodex API routes (depends: T2)
  T4: Add Kodex MCP tools (depends: T2)

Phase 3 (Frontend):
  T5: Create Kodex UI (depends: T3, T4)
  T6: Add cross-links (depends: T5)
```

---

## T1: Update Session Paths

**Files to modify:**

### src/services/session-registry.ts
- Update `getSessionPath()` to use `.collab/sessions/<name>/`
- Add migration logic for old paths

### src/mcp/setup.ts
- Update paths in document/diagram tools

### skills/* (multiple files)
- Update any hardcoded `.collab/<name>/` paths to `.collab/sessions/<name>/`

---

## T2: Create KodexManager Service

**New file: src/services/kodex-manager.ts**

```typescript
import Database from 'bun:sqlite';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';

// Types
export interface TopicMetadata { /* from interfaces */ }
export interface TopicContent { /* from interfaces */ }
export interface Topic extends TopicMetadata { content: TopicContent; }
export interface Draft { /* from interfaces */ }
export interface Flag { /* from interfaces */ }
export interface DashboardStats { /* from interfaces */ }

export class KodexManager {
  private db: Database;
  private kodexDir: string;
  private topicsDir: string;

  constructor(projectPath: string) {
    // TODO: Initialize paths and database
  }

  // Topic CRUD
  async listTopics(): Promise<TopicMetadata[]> { /* TODO */ }
  async getTopic(name: string, includeContent?: boolean): Promise<Topic | null> { /* TODO */ }
  async createTopic(name: string, content: TopicContent, createdBy: string): Promise<Draft> { /* TODO */ }
  async updateTopic(name: string, content: Partial<TopicContent>, reason: string): Promise<Draft> { /* TODO */ }
  async deleteTopic(name: string): Promise<void> { /* TODO */ }
  async verifyTopic(name: string, verifiedBy: string): Promise<void> { /* TODO */ }

  // Draft management
  async listDrafts(): Promise<Draft[]> { /* TODO */ }
  async getDraft(topicName: string): Promise<Draft | null> { /* TODO */ }
  async approveDraft(topicName: string): Promise<Topic> { /* TODO */ }
  async rejectDraft(topicName: string): Promise<void> { /* TODO */ }

  // Flag management
  async listFlags(status?: Flag['status']): Promise<Flag[]> { /* TODO */ }
  async createFlag(topicName: string, type: Flag['type'], description: string): Promise<Flag> { /* TODO */ }
  async updateFlagStatus(id: number, status: Flag['status']): Promise<void> { /* TODO */ }

  // Analytics
  async logAccess(topicName: string, source: string, context?: string): Promise<void> { /* TODO */ }
  async logMissing(topicName: string, context?: string): Promise<void> { /* TODO */ }
  async getDashboardStats(): Promise<DashboardStats> { /* TODO */ }
  async getMissingTopics(): Promise<any[]> { /* TODO */ }

  // Private helpers
  private readTopicContent(name: string): TopicContent { /* TODO */ }
  private readDraftContent(name: string): TopicContent { /* TODO */ }
}
```

---

## T3: Add Kodex API Routes

**New file: src/routes/kodex-api.ts**

```typescript
import { KodexManager } from '../services/kodex-manager';

let kodexManager: KodexManager | null = null;

function getKodexManager(projectPath: string): KodexManager {
  if (!kodexManager) {
    kodexManager = new KodexManager(projectPath);
  }
  return kodexManager;
}

export async function handleKodexAPI(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/kodex', '');
  
  // TODO: Route to handlers based on path and method
  // GET /topics
  // GET /topics/:name
  // POST /topics
  // PUT /topics/:name
  // DELETE /topics/:name
  // POST /topics/:name/verify
  // GET /flags
  // POST /topics/:name/flag
  // PUT /flags/:id
  // GET /drafts
  // POST /drafts/:name/approve
  // POST /drafts/:name/reject
  // GET /dashboard
  // GET /missing
  
  return new Response('Not found', { status: 404 });
}
```

**Modify: src/server.ts**
- Add route: `if (url.pathname.startsWith('/api/kodex')) return handleKodexAPI(req);`

---

## T4: Add Kodex MCP Tools

**New file: src/mcp/tools/kodex.ts**

```typescript
import { KodexManager } from '../../services/kodex-manager';

export function registerKodexTools(server: Server) {
  // kodex_query_topic
  server.setRequestHandler(/* TODO */);
  
  // kodex_list_topics
  server.setRequestHandler(/* TODO */);
  
  // kodex_create_topic
  server.setRequestHandler(/* TODO */);
  
  // kodex_update_topic
  server.setRequestHandler(/* TODO */);
  
  // kodex_flag_topic
  server.setRequestHandler(/* TODO */);
  
  // kodex_verify_topic
  server.setRequestHandler(/* TODO */);
  
  // kodex_list_drafts
  server.setRequestHandler(/* TODO */);
  
  // kodex_approve_draft
  server.setRequestHandler(/* TODO */);
  
  // kodex_reject_draft
  server.setRequestHandler(/* TODO */);
}
```

**Modify: src/mcp/setup.ts**
- Import and call `registerKodexTools(server)`

---

## T5: Create Kodex UI

**New files in ui/src/pages/kodex/:**

```
KodexLayout.tsx      - Layout wrapper with sidebar
Dashboard.tsx        - Overview stats page
TopicBrowser.tsx     - Topic list with search
TopicDetail.tsx      - View single topic
TopicEditor.tsx      - Edit topic (creates draft)
Flags.tsx            - Flag management
DraftReview.tsx      - Review pending drafts
MissingTopics.tsx    - View missing topic requests
```

**New files in ui/src/components/kodex/:**

```
KodexSidebar.tsx     - Navigation sidebar
TopicCard.tsx        - Topic summary card
TopicList.tsx        - Filterable list
TopicContent.tsx     - Render 4 markdown sections
FlagList.tsx         - Flag list
FlagCard.tsx         - Single flag
DraftDiff.tsx        - Side-by-side diff
ConfidenceBadge.tsx  - Confidence indicator
MetadataPanel.tsx    - Topic metadata
```

**Modify: ui/src/App.tsx**
- Add routes under `/kodex/*`

---

## T6: Add Cross-Links

**Modify: ui/src/components/Sidebar.tsx (Collab)**
- Add "Kodex" link at bottom

**Modify: ui/src/components/kodex/KodexSidebar.tsx**
- Add "Collab" link at bottom

**Modify: ui/src/components/Header.tsx (or both headers)**
- Add section indicator badge

---

## Execution Order

1. **T1** - Update session paths (required for T2)
2. **T2** - Create KodexManager (foundation for everything)
3. **T3 & T4** - API routes and MCP tools (can run in parallel)
4. **T5** - Kodex UI (needs API)
5. **T6** - Cross-links (finishing touch)
