## Storage Structure

```
.collab/kodex/
├── kodex.db       # SQLite metadata
└── topics/
    ├── topic-name.md      # Live content
    └── topic-name.draft.md # Pending draft
```

## SQLite Schema

```sql
-- Topics metadata
CREATE TABLE topics (
  name TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  confidence TEXT CHECK(confidence IN ('low', 'medium', 'high')),
  verified INTEGER DEFAULT 0,
  verified_at TEXT,
  verified_by TEXT,
  has_draft INTEGER DEFAULT 0
);

-- Access tracking
CREATE TABLE access_log (
  topic_name TEXT, accessed_at TEXT, source TEXT, context TEXT
);

-- Flags for review
CREATE TABLE flags (
  topic_name TEXT,
  type TEXT CHECK(type IN ('outdated', 'incorrect', 'incomplete', 'missing')),
  status TEXT CHECK(status IN ('open', 'resolved', 'dismissed'))
);

-- Missing topic requests
CREATE TABLE missing_topics (topic_name TEXT, count INTEGER);
```

## Topic Content Format

```yaml
---
name: topic-name
title: Topic Title
confidence: low|medium|high
---

## Conceptual
[Overview and purpose]

## Technical
[Implementation details]

## Files
[Related source files]

## Related
[Related topics]
```

## KodexManager API

```typescript
class KodexManager {
  // Topics
  getTopic(name: string): Promise<Topic | null>
  listTopics(): Promise<TopicMetadata[]>
  createTopic(name, title, content): Promise<Draft>
  updateTopic(name, content, reason): Promise<Draft>
  
  // Drafts
  listDrafts(): Promise<Draft[]>
  approveDraft(name): Promise<Topic>  // Auto-resolves flags
  rejectDraft(name): Promise<void>
  
  // Flags
  createFlag(name, type, description): Promise<Flag>
  listFlags(status?): Promise<Flag[]>
  
  // Verification
  verifyTopic(name, verifiedBy): Promise<void>
  
  // Analytics
  getDashboardStats(): Promise<DashboardStats>
}
```

## Flag Auto-Resolution

When a draft is approved, any open flags for that topic are automatically resolved.