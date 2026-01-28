# Pseudocode: Item 6

## Auto-flag Kodex topics from skills

### src/services/kodex-manager.ts

#### hasFlag(topicName, type)

```
FUNCTION hasFlag(topicName, type):
  flags = await this.listFlags({ status: 'open' })
  
  FOR flag IN flags:
    IF flag.topicName === topicName AND flag.type === type:
      RETURN true
  
  RETURN false
```

#### createFlag(topicName, type, description, options?)

```
FUNCTION createFlag(topicName, type, description, options = {}):
  // Check for duplicates if dedupe enabled
  IF options.dedupe:
    exists = await this.hasFlag(topicName, type)
    IF exists:
      RETURN { created: false, reason: 'Duplicate flag exists' }
  
  // Build description with context
  fullDescription = description
  IF options.context:
    fullDescription = `${description} (Context: ${options.context})`
  
  // Create the flag
  flag = {
    topicName,
    type,
    description: fullDescription,
    status: 'open',
    createdAt: new Date().toISOString()
  }
  
  await this.saveFlag(flag)
  
  RETURN { created: true }
```

### src/mcp/setup.ts

#### kodex_query_topic tool handler (modify)

```
CASE 'kodex_query_topic':
  project = params.project
  topicName = params.name
  includeContent = params.include_content ?? true
  
  // Query the topic
  topic = await kodexManager.queryTopic(project, topicName, { includeContent })
  
  IF NOT topic:
    // Auto-flag missing topics
    flagResult = await kodexManager.createFlag(
      topicName,
      'missing',
      `Topic not found when queried`,
      { dedupe: true }
    )
    
    RETURN {
      content: [{
        type: 'text',
        text: JSON.stringify({
          found: false,
          error: 'Topic not found',
          flagged: flagResult.created,
          message: flagResult.created 
            ? 'Auto-flagged as missing'
            : 'Already flagged as missing'
        })
      }]
    }
  
  // Topic found - include hint about flagging
  RETURN {
    content: [{
      type: 'text',
      text: JSON.stringify({
        found: true,
        topic: topic,
        hint: 'If this topic is outdated, incorrect, or incomplete, use kodex_flag_topic to report it.'
      })
    }]
  }
```

### Verification

- [x] All functions from interface covered
- [x] hasFlag checks for existing open flags
- [x] createFlag with dedupe prevents duplicates
- [x] Auto-flag only for 'missing' type
- [x] Hint included in successful queries
