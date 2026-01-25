# Pseudocode: Item 4b - Collab Codex SQLite Storage Layer

## initDatabase(config)

```
FUNCTION initDatabase(config):
  1. Create database connection
     db = new Database(config.path)
  
  2. Enable foreign keys
     db.pragma('foreign_keys = ON')
  
  3. Run migrations
     runMigrations(db)
  
  4. Return db
```

## runMigrations(db)

```
FUNCTION runMigrations(db):
  1. Read schema.sql
  2. Execute each CREATE TABLE statement
  3. Create indexes:
     - topics(name) - unique
     - flags(topic_id, status)
     - access_log(topic_id, accessed_at)
     - missing_topics(topic_name)
```

## ConfidenceService.calculate(topicId)

```
FUNCTION calculate(topicId):
  1. Get topic record
     topic = getTopicById(topicId)
  
  2. Get open flag count
     openFlags = flagService.getOpenCount(topicId)
  
  3. Calculate days since verification
     IF topic.lastVerifiedAt is null:
       RETURN 'unknown'
     
     daysSinceVerified = daysBetween(topic.lastVerifiedAt, now())
  
  4. Apply confidence rules:
     IF daysSinceVerified < 7 AND openFlags == 0:
       RETURN 'high'
     ELIF daysSinceVerified < 30 AND openFlags <= 1:
       RETURN 'medium'
     ELIF daysSinceVerified > 30 OR openFlags > 1:
       RETURN 'low'
     ELSE:
       RETURN 'unknown'
```

## AccessService.refreshAggregates()

```
FUNCTION refreshAggregates():
  # Run periodically or on-demand
  
  1. Calculate total counts per topic
     UPDATE access_counts SET total_count = (
       SELECT COUNT(*) FROM access_log 
       WHERE access_log.topic_id = access_counts.topic_id
     )
  
  2. Calculate last 30 days counts
     thirtyDaysAgo = now() - 30 days
     UPDATE access_counts SET last_30_days = (
       SELECT COUNT(*) FROM access_log 
       WHERE access_log.topic_id = access_counts.topic_id
       AND accessed_at > thirtyDaysAgo
     )
  
  3. Update last_accessed_at
     UPDATE access_counts SET last_accessed_at = (
       SELECT MAX(accessed_at) FROM access_log
       WHERE access_log.topic_id = access_counts.topic_id
     )
```

## FlagService Lifecycle

```
create(topicId, comment):
  INSERT INTO flags (topic_id, comment, status) 
  VALUES (topicId, comment, 'open')

resolve(flagId):
  UPDATE flags SET status = 'resolved', resolved_at = now()
  WHERE id = flagId

dismiss(flagId, reason):
  UPDATE flags SET status = 'dismissed', resolved_at = now()
  WHERE id = flagId
  # Store reason in separate field or note

reopen(flagId):
  UPDATE flags SET status = 'open', resolved_at = NULL
  WHERE id = flagId
```
