# Kodex Interfaces

## Core Data Types

```typescript
// Topic metadata stored in SQLite
interface TopicMetadata {
  name: string;              // Primary key, kebab-case
  title: string;             // Human-readable title
  confidence: 'low' | 'medium' | 'high';
  verified: boolean;
  verifiedAt: string | null; // ISO timestamp
  verifiedBy: string | null; // Who verified
  createdAt: string;         // ISO timestamp
  updatedAt: string;         // ISO timestamp
  hasDraft: boolean;         // Has pending draft
}

// Topic content from markdown files
interface TopicContent {
  conceptual: string;        // conceptual.md content
  technical: string;         // technical.md content
  files: string;             // files.md content
  related: string;           // related.md content
}

// Full topic (metadata + content)
interface Topic extends TopicMetadata {
  content: TopicContent;
}

// Draft for pending changes
interface Draft {
  topicName: string;
  content: TopicContent;
  createdAt: string;
  createdBy: string;         // 'claude' or 'human'
  reason: string;            // Why this draft was created
}

// Flag for issues
interface Flag {
  id: number;
  topicName: string;
  type: 'outdated' | 'incorrect' | 'incomplete' | 'missing';
  description: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt: string | null;
}

// Access log entry
interface AccessLogEntry {
  id: number;
  topicName: string;
  accessedAt: string;
  source: 'mcp' | 'api' | 'ui';
  context: string | null;    // Session or request context
}

// Missing topic request
interface MissingTopicEntry {
  id: number;
  topicName: string;
  requestedAt: string;
  context: string | null;
  count: number;             // Times requested
}

// Dashboard stats
interface DashboardStats {
  totalTopics: number;
  verifiedTopics: number;
  pendingDrafts: number;
  openFlags: number;
  recentAccess: AccessLogEntry[];
  topMissing: MissingTopicEntry[];
}
```

## Service Layer Interface

```typescript
interface KodexManager {
  // Initialization
  init(projectPath: string): Promise<void>;
  
  // Topic CRUD
  listTopics(): Promise<TopicMetadata[]>;
  getTopic(name: string, includeContent?: boolean): Promise<Topic | null>;
  createTopic(name: string, content: TopicContent, createdBy: string): Promise<Draft>;
  updateTopic(name: string, content: TopicContent, reason: string): Promise<Draft>;
  deleteTopic(name: string): Promise<void>;
  verifyTopic(name: string, verifiedBy: string): Promise<void>;
  
  // Draft management
  listDrafts(): Promise<Draft[]>;
  getDraft(topicName: string): Promise<Draft | null>;
  approveDraft(topicName: string): Promise<Topic>;
  rejectDraft(topicName: string): Promise<void>;
  
  // Flag management
  listFlags(status?: Flag['status']): Promise<Flag[]>;
  createFlag(topicName: string, type: Flag['type'], description: string): Promise<Flag>;
  updateFlagStatus(id: number, status: Flag['status']): Promise<void>;
  
  // Analytics
  logAccess(topicName: string, source: AccessLogEntry['source'], context?: string): Promise<void>;
  logMissing(topicName: string, context?: string): Promise<void>;
  getDashboardStats(): Promise<DashboardStats>;
  getMissingTopics(): Promise<MissingTopicEntry[]>;
}
```

## MCP Tool Schemas

```typescript
// kodex_query_topic
interface QueryTopicInput {
  name: string;
  include_content?: boolean;  // Default: true
}
interface QueryTopicOutput {
  found: boolean;
  topic?: Topic;
  error?: string;
}

// kodex_list_topics
interface ListTopicsInput {
  filter?: 'all' | 'verified' | 'unverified' | 'has_draft';
}
interface ListTopicsOutput {
  topics: TopicMetadata[];
}

// kodex_create_topic
interface CreateTopicInput {
  name: string;
  title: string;
  content: TopicContent;
}
interface CreateTopicOutput {
  draft: Draft;
  message: string;
}

// kodex_update_topic
interface UpdateTopicInput {
  name: string;
  content: Partial<TopicContent>;
  reason: string;
}
interface UpdateTopicOutput {
  draft: Draft;
  message: string;
}

// kodex_flag_topic
interface FlagTopicInput {
  name: string;
  type: Flag['type'];
  description: string;
}
interface FlagTopicOutput {
  flag: Flag;
}

// kodex_verify_topic (human only)
interface VerifyTopicInput {
  name: string;
}
interface VerifyTopicOutput {
  topic: TopicMetadata;
}

// kodex_list_drafts
interface ListDraftsOutput {
  drafts: Draft[];
}

// kodex_approve_draft (human only)
interface ApproveDraftInput {
  name: string;
}
interface ApproveDraftOutput {
  topic: Topic;
  message: string;
}

// kodex_reject_draft (human only)
interface RejectDraftInput {
  name: string;
}
interface RejectDraftOutput {
  message: string;
}
```

## API Route Types

```typescript
// GET /api/kodex/topics
type ListTopicsResponse = TopicMetadata[];

// GET /api/kodex/topics/:name
type GetTopicResponse = Topic;

// POST /api/kodex/topics
interface CreateTopicRequest {
  name: string;
  title: string;
  content: TopicContent;
  createdBy?: string;
}
type CreateTopicResponse = Draft;

// PUT /api/kodex/topics/:name
interface UpdateTopicRequest {
  content: Partial<TopicContent>;
  reason: string;
}
type UpdateTopicResponse = Draft;

// POST /api/kodex/topics/:name/verify
interface VerifyTopicRequest {
  verifiedBy: string;
}
type VerifyTopicResponse = TopicMetadata;

// GET /api/kodex/flags
type ListFlagsResponse = Flag[];

// POST /api/kodex/topics/:name/flag
interface CreateFlagRequest {
  type: Flag['type'];
  description: string;
}
type CreateFlagResponse = Flag;

// PUT /api/kodex/flags/:id
interface UpdateFlagRequest {
  status: Flag['status'];
}
type UpdateFlagResponse = Flag;

// GET /api/kodex/drafts
type ListDraftsResponse = Draft[];

// POST /api/kodex/drafts/:name/approve
type ApproveDraftResponse = Topic;

// POST /api/kodex/drafts/:name/reject
type RejectDraftResponse = { message: string };

// GET /api/kodex/dashboard
type DashboardResponse = DashboardStats;

// GET /api/kodex/missing
type MissingTopicsResponse = MissingTopicEntry[];
```

## SQLite Schema

```sql
-- Topics metadata
CREATE TABLE topics (
  name TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  confidence TEXT CHECK(confidence IN ('low', 'medium', 'high')) DEFAULT 'low',
  verified INTEGER DEFAULT 0,
  verified_at TEXT,
  verified_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  has_draft INTEGER DEFAULT 0
);

-- Access log (per-access)
CREATE TABLE access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_name TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  source TEXT CHECK(source IN ('mcp', 'api', 'ui')) NOT NULL,
  context TEXT
);

-- Access counts (aggregated)
CREATE TABLE access_counts (
  topic_name TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  last_accessed TEXT
);

-- Missing topics
CREATE TABLE missing_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_name TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  context TEXT,
  count INTEGER DEFAULT 1,
  UNIQUE(topic_name)
);

-- Flags
CREATE TABLE flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_name TEXT NOT NULL,
  type TEXT CHECK(type IN ('outdated', 'incorrect', 'incomplete', 'missing')) NOT NULL,
  description TEXT NOT NULL,
  status TEXT CHECK(status IN ('open', 'resolved', 'dismissed')) DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- Generation context (for AI-generated content)
CREATE TABLE generation_context (
  topic_name TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  model TEXT,
  prompt_hash TEXT,
  source_files TEXT  -- JSON array of file paths used
);

-- Indexes
CREATE INDEX idx_access_log_topic ON access_log(topic_name);
CREATE INDEX idx_access_log_time ON access_log(accessed_at);
CREATE INDEX idx_flags_status ON flags(status);
CREATE INDEX idx_flags_topic ON flags(topic_name);
```
