# Interface: Item 4b - Collab Codex SQLite Storage Layer

## Interface Definition

### File Structure

- `codex/src/db/schema.sql` - SQLite schema definition
- `codex/src/db/database.ts` - Database connection and initialization
- `codex/src/services/topic-service.ts` - Topic CRUD operations
- `codex/src/services/flag-service.ts` - Flag CRUD operations
- `codex/src/services/access-service.ts` - Access logging and counts
- `codex/src/services/confidence-service.ts` - Confidence tier calculation

### Type Definitions

```typescript
// codex/src/db/database.ts
import Database from 'better-sqlite3';

interface DbConfig {
  path: string;  // Path to codex.db
}

// codex/src/services/topic-service.ts
interface TopicRecord {
  id: number;
  name: string;
  createdAt: string;
  lastModifiedAt: string | null;
  lastVerifiedAt: string | null;
  confidenceTier: ConfidenceTier;
  hasDraft: boolean;
}

// codex/src/services/flag-service.ts
type FlagStatus = 'open' | 'addressed' | 'resolved' | 'dismissed';

interface FlagRecord {
  id: number;
  topicId: number;
  comment: string;
  status: FlagStatus;
  createdAt: string;
  addressedAt: string | null;
  resolvedAt: string | null;
}

// codex/src/services/access-service.ts
interface AccessCount {
  topicId: number;
  totalCount: number;
  last30Days: number;
  lastAccessedAt: string;
}
```

### Function Signatures

```typescript
// codex/src/db/database.ts
function initDatabase(config: DbConfig): Database.Database
function runMigrations(db: Database.Database): void

// codex/src/services/topic-service.ts
class TopicService {
  constructor(db: Database.Database)
  getByName(name: string): TopicRecord | null
  create(name: string): TopicRecord
  updateVerified(name: string): void
  updateModified(name: string): void
  list(): TopicRecord[]
  setHasDraft(name: string, hasDraft: boolean): void
}

// codex/src/services/flag-service.ts
class FlagService {
  constructor(db: Database.Database)
  create(topicId: number, comment: string): FlagRecord
  resolve(flagId: number): void
  dismiss(flagId: number, reason?: string): void
  reopen(flagId: number): void
  getByTopic(topicId: number): FlagRecord[]
  getOpenCount(topicId: number): number
}

// codex/src/services/access-service.ts
class AccessService {
  constructor(db: Database.Database)
  logAccess(topicId: number): void
  getCounts(topicId: number): AccessCount
  refreshAggregates(): void  // Recalculate last_30_days counts
}

// codex/src/services/confidence-service.ts
class ConfidenceService {
  constructor(db: Database.Database)
  calculate(topicId: number): ConfidenceTier
  // Logic: verified <7d + 0 flags = high
  //        verified <30d + ≤1 flag = medium
  //        verified >30d OR >1 flags = low
  //        never verified = unknown
}
```
