# Pseudocode: Item 4a - Collab Codex MCP Server Core

## queryTopic(name)

```
FUNCTION queryTopic(name):
  1. Validate topic name (non-empty, alphanumeric with hyphens)
     - If invalid: return error "Invalid topic name"
  
  2. Check if topic exists in database
     topicRecord = topicService.getByName(name)
     
     IF topicRecord is null:
       a. Log to missing_topics table (increment count if exists)
       b. Return error "Topic not found"
  
  3. Read 4 markdown files from disk:
     basePath = `codex/topics/${name}/`
     documents = {
       conceptual: readFile(basePath + 'conceptual.md'),
       technical: readFile(basePath + 'technical.md'),
       files: readFile(basePath + 'files.md'),
       related: readFile(basePath + 'related.md')
     }
     
     - If any file missing: return partial with available docs
  
  4. Log access for analytics
     accessService.logAccess(topicRecord.id)
  
  5. Get current confidence tier
     confidence = confidenceService.calculate(topicRecord.id)
  
  6. Get access count
     counts = accessService.getCounts(topicRecord.id)
  
  7. Return {
       topic: name,
       confidence: confidence,
       lastModified: topicRecord.lastModifiedAt,
       lastVerified: topicRecord.lastVerifiedAt,
       accessCount: counts.totalCount,
       documents: documents
     }
```

## flagTopic(input)

```
FUNCTION flagTopic({ topicName, comment }):
  1. Validate inputs
     - topicName: non-empty
     - comment: non-empty, max 1000 chars
  
  2. Get topic record
     topicRecord = topicService.getByName(topicName)
     IF topicRecord is null:
       Return error "Topic not found"
  
  3. Create flag record
     flag = flagService.create(topicRecord.id, comment)
  
  4. Return {
       success: true,
       flagId: flag.id,
       message: "Topic flagged for review"
     }
```

## listTopics()

```
FUNCTION listTopics():
  1. Get all topics from database
     topics = topicService.list()
  
  2. For each topic, enrich with computed fields:
     FOR topic in topics:
       topic.confidence = confidenceService.calculate(topic.id)
       topic.openFlagCount = flagService.getOpenCount(topic.id)
       counts = accessService.getCounts(topic.id)
       topic.accessCount = counts.last30Days
  
  3. Return { topics: enrichedTopics }
```

## Error Handling

- Database errors: Log, return 500 with generic message
- File read errors: Return partial response with available docs
- Validation errors: Return 400 with specific message
