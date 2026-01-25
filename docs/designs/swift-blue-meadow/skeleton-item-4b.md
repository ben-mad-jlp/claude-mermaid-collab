# Skeleton: Item 4b - Collab Codex SQLite Storage Layer

## Planned Files

| File | Purpose |
|------|---------|
| `codex/src/db/schema.sql` | SQLite schema definition |
| `codex/src/db/database.ts` | Database connection and initialization |
| `codex/src/services/topic-service.ts` | Topic CRUD operations |
| `codex/src/services/flag-service.ts` | Flag CRUD with lifecycle |
| `codex/src/services/access-service.ts` | Access logging and aggregates |
| `codex/src/services/confidence-service.ts` | Confidence tier calculation |

## Task Dependency Graph

```yaml
tasks:
  - id: 4b-schema
    files: [codex/src/db/schema.sql]
    description: Create SQLite schema with topics, flags, access_log, access_counts, missing_topics tables
    parallel: true

  - id: 4b-database
    files: [codex/src/db/database.ts]
    description: Database connection, initialization, and migration runner
    depends-on: [4b-schema]

  - id: 4b-topic-service
    files: [codex/src/services/topic-service.ts]
    description: TopicService class with CRUD, verification, and draft tracking
    depends-on: [4b-database, 4a-types]

  - id: 4b-flag-service
    files: [codex/src/services/flag-service.ts]
    description: FlagService class with create/resolve/dismiss/reopen lifecycle
    depends-on: [4b-database, 4a-types]

  - id: 4b-access-service
    files: [codex/src/services/access-service.ts]
    description: AccessService with logging and aggregate refresh
    depends-on: [4b-database, 4a-types]

  - id: 4b-confidence-service
    files: [codex/src/services/confidence-service.ts]
    description: ConfidenceService with tier calculation rules
    depends-on: [4b-database, 4b-flag-service, 4a-types]
```

## Execution Order

1. **Parallel batch 1:** 4b-schema (can start immediately)
2. **Parallel batch 2:** 4b-database (after schema)
3. **Parallel batch 3:** 4b-topic-service, 4b-flag-service, 4b-access-service (after database, types)
4. **Parallel batch 4:** 4b-confidence-service (after flag service for count queries)

## Notes

- Uses better-sqlite3 for synchronous SQLite access
- Confidence rules: verified <7d + 0 flags = high, <30d + ≤1 = medium, >30d or >1 = low
- Access aggregates refreshed on-demand or periodically
