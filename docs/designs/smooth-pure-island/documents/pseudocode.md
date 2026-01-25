# Kodex Pseudocode

## KodexManager Service

### Initialization

```
FUNCTION init(projectPath):
  kodexDir = projectPath + "/.collab/kodex"
  dbPath = kodexDir + "/kodex.db"
  topicsDir = kodexDir + "/topics"
  
  IF NOT exists(kodexDir):
    mkdir(kodexDir)
    mkdir(topicsDir)
  
  db = openSQLite(dbPath)
  
  IF NOT tableExists("topics"):
    executeSchema(CREATE_TABLES_SQL)
  
  RETURN this
```

### Topic CRUD

```
FUNCTION listTopics():
  rows = db.query("SELECT * FROM topics ORDER BY updated_at DESC")
  RETURN rows.map(rowToTopicMetadata)

FUNCTION getTopic(name, includeContent = true):
  row = db.queryOne("SELECT * FROM topics WHERE name = ?", name)
  
  IF NOT row:
    logMissing(name, "getTopic")
    RETURN null
  
  logAccess(name, "api")
  
  IF NOT includeContent:
    RETURN rowToTopicMetadata(row)
  
  content = readTopicContent(name)
  RETURN { ...rowToTopicMetadata(row), content }

FUNCTION createTopic(name, content, createdBy):
  // Always creates as draft
  draftDir = topicsDir + "/" + name + "/draft"
  mkdir(draftDir)
  
  writeFile(draftDir + "/conceptual.md", content.conceptual)
  writeFile(draftDir + "/technical.md", content.technical)
  writeFile(draftDir + "/files.md", content.files)
  writeFile(draftDir + "/related.md", content.related)
  
  // Insert metadata with has_draft = true
  now = isoTimestamp()
  db.run("""
    INSERT INTO topics (name, title, created_at, updated_at, has_draft)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(name) DO UPDATE SET has_draft = 1, updated_at = ?
  """, name, title, now, now, now)
  
  RETURN { topicName: name, content, createdAt: now, createdBy, reason: "New topic" }

FUNCTION updateTopic(name, content, reason):
  existing = db.queryOne("SELECT * FROM topics WHERE name = ?", name)
  IF NOT existing:
    THROW "Topic not found"
  
  // Create draft with changes
  draftDir = topicsDir + "/" + name + "/draft"
  mkdir(draftDir)
  
  currentContent = readTopicContent(name)
  mergedContent = { ...currentContent, ...content }
  
  writeFile(draftDir + "/conceptual.md", mergedContent.conceptual)
  writeFile(draftDir + "/technical.md", mergedContent.technical)
  writeFile(draftDir + "/files.md", mergedContent.files)
  writeFile(draftDir + "/related.md", mergedContent.related)
  
  db.run("UPDATE topics SET has_draft = 1, updated_at = ? WHERE name = ?", isoTimestamp(), name)
  
  RETURN { topicName: name, content: mergedContent, createdAt: isoTimestamp(), createdBy: "claude", reason }

FUNCTION deleteTopic(name):
  rmdir(topicsDir + "/" + name)
  db.run("DELETE FROM topics WHERE name = ?", name)
  db.run("DELETE FROM flags WHERE topic_name = ?", name)

FUNCTION verifyTopic(name, verifiedBy):
  now = isoTimestamp()
  db.run("""
    UPDATE topics 
    SET verified = 1, verified_at = ?, verified_by = ?, confidence = 'high'
    WHERE name = ?
  """, now, verifiedBy, name)
```

### Draft Management

```
FUNCTION listDrafts():
  rows = db.query("SELECT * FROM topics WHERE has_draft = 1")
  drafts = []
  
  FOR row IN rows:
    draftContent = readDraftContent(row.name)
    drafts.push({
      topicName: row.name,
      content: draftContent,
      createdAt: row.updated_at,
      createdBy: "claude",
      reason: "Update"
    })
  
  RETURN drafts

FUNCTION getDraft(topicName):
  row = db.queryOne("SELECT * FROM topics WHERE name = ? AND has_draft = 1", topicName)
  IF NOT row:
    RETURN null
  
  content = readDraftContent(topicName)
  RETURN { topicName, content, createdAt: row.updated_at, createdBy: "claude", reason: "Update" }

FUNCTION approveDraft(topicName):
  draftDir = topicsDir + "/" + topicName + "/draft"
  liveDir = topicsDir + "/" + topicName
  
  // Move draft files to live
  FOR file IN ["conceptual.md", "technical.md", "files.md", "related.md"]:
    IF exists(draftDir + "/" + file):
      move(draftDir + "/" + file, liveDir + "/" + file)
  
  rmdir(draftDir)
  
  now = isoTimestamp()
  db.run("UPDATE topics SET has_draft = 0, updated_at = ? WHERE name = ?", now, topicName)
  
  RETURN getTopic(topicName)

FUNCTION rejectDraft(topicName):
  draftDir = topicsDir + "/" + topicName + "/draft"
  rmdir(draftDir)
  db.run("UPDATE topics SET has_draft = 0 WHERE name = ?", topicName)
```

### Flag Management

```
FUNCTION listFlags(status = null):
  IF status:
    rows = db.query("SELECT * FROM flags WHERE status = ? ORDER BY created_at DESC", status)
  ELSE:
    rows = db.query("SELECT * FROM flags ORDER BY created_at DESC")
  RETURN rows.map(rowToFlag)

FUNCTION createFlag(topicName, type, description):
  now = isoTimestamp()
  result = db.run("""
    INSERT INTO flags (topic_name, type, description, created_at)
    VALUES (?, ?, ?, ?)
  """, topicName, type, description, now)
  
  RETURN { id: result.lastInsertRowid, topicName, type, description, status: "open", createdAt: now }

FUNCTION updateFlagStatus(id, status):
  resolvedAt = status === "open" ? null : isoTimestamp()
  db.run("UPDATE flags SET status = ?, resolved_at = ? WHERE id = ?", status, resolvedAt, id)
```

### Analytics

```
FUNCTION logAccess(topicName, source, context = null):
  now = isoTimestamp()
  
  // Insert into access_log
  db.run("""
    INSERT INTO access_log (topic_name, accessed_at, source, context)
    VALUES (?, ?, ?, ?)
  """, topicName, now, source, context)
  
  // Update access_counts
  db.run("""
    INSERT INTO access_counts (topic_name, count, last_accessed)
    VALUES (?, 1, ?)
    ON CONFLICT(topic_name) DO UPDATE SET 
      count = count + 1,
      last_accessed = ?
  """, topicName, now, now)

FUNCTION logMissing(topicName, context = null):
  now = isoTimestamp()
  db.run("""
    INSERT INTO missing_topics (topic_name, requested_at, context, count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(topic_name) DO UPDATE SET 
      count = count + 1,
      requested_at = ?
  """, topicName, now, context, now)

FUNCTION getDashboardStats():
  totalTopics = db.queryOne("SELECT COUNT(*) as count FROM topics").count
  verifiedTopics = db.queryOne("SELECT COUNT(*) as count FROM topics WHERE verified = 1").count
  pendingDrafts = db.queryOne("SELECT COUNT(*) as count FROM topics WHERE has_draft = 1").count
  openFlags = db.queryOne("SELECT COUNT(*) as count FROM flags WHERE status = 'open'").count
  
  recentAccess = db.query("""
    SELECT * FROM access_log 
    ORDER BY accessed_at DESC 
    LIMIT 10
  """)
  
  topMissing = db.query("""
    SELECT * FROM missing_topics 
    ORDER BY count DESC 
    LIMIT 10
  """)
  
  RETURN { totalTopics, verifiedTopics, pendingDrafts, openFlags, recentAccess, topMissing }

FUNCTION getMissingTopics():
  RETURN db.query("SELECT * FROM missing_topics ORDER BY count DESC")
```

### Helper Functions

```
FUNCTION readTopicContent(name):
  dir = topicsDir + "/" + name
  RETURN {
    conceptual: readFileOrEmpty(dir + "/conceptual.md"),
    technical: readFileOrEmpty(dir + "/technical.md"),
    files: readFileOrEmpty(dir + "/files.md"),
    related: readFileOrEmpty(dir + "/related.md")
  }

FUNCTION readDraftContent(name):
  dir = topicsDir + "/" + name + "/draft"
  RETURN {
    conceptual: readFileOrEmpty(dir + "/conceptual.md"),
    technical: readFileOrEmpty(dir + "/technical.md"),
    files: readFileOrEmpty(dir + "/files.md"),
    related: readFileOrEmpty(dir + "/related.md")
  }

FUNCTION readFileOrEmpty(path):
  IF exists(path):
    RETURN readFile(path)
  RETURN ""

FUNCTION rowToTopicMetadata(row):
  RETURN {
    name: row.name,
    title: row.title,
    confidence: row.confidence,
    verified: Boolean(row.verified),
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasDraft: Boolean(row.has_draft)
  }
```

---

## MCP Tool Handlers

```
FUNCTION handleKodexQueryTopic(input):
  { name, include_content = true } = input
  topic = kodexManager.getTopic(name, include_content)
  
  IF NOT topic:
    RETURN { found: false, error: "Topic not found" }
  
  RETURN { found: true, topic }

FUNCTION handleKodexListTopics(input):
  { filter = "all" } = input
  topics = kodexManager.listTopics()
  
  IF filter === "verified":
    topics = topics.filter(t => t.verified)
  ELSE IF filter === "unverified":
    topics = topics.filter(t => !t.verified)
  ELSE IF filter === "has_draft":
    topics = topics.filter(t => t.hasDraft)
  
  RETURN { topics }

FUNCTION handleKodexCreateTopic(input):
  { name, title, content } = input
  draft = kodexManager.createTopic(name, content, "claude")
  RETURN { draft, message: "Draft created. Requires human approval." }

FUNCTION handleKodexUpdateTopic(input):
  { name, content, reason } = input
  draft = kodexManager.updateTopic(name, content, reason)
  RETURN { draft, message: "Draft created. Requires human approval." }

FUNCTION handleKodexFlagTopic(input):
  { name, type, description } = input
  flag = kodexManager.createFlag(name, type, description)
  RETURN { flag }
```

---

## API Route Handlers

```
FUNCTION handleGetTopics(req):
  topics = kodexManager.listTopics()
  RETURN Response.json(topics)

FUNCTION handleGetTopic(req, name):
  topic = kodexManager.getTopic(name, true)
  IF NOT topic:
    RETURN Response.json({ error: "Not found" }, { status: 404 })
  RETURN Response.json(topic)

FUNCTION handleCreateTopic(req):
  { name, title, content, createdBy } = await req.json()
  draft = kodexManager.createTopic(name, content, createdBy || "api")
  RETURN Response.json(draft, { status: 201 })

FUNCTION handleUpdateTopic(req, name):
  { content, reason } = await req.json()
  draft = kodexManager.updateTopic(name, content, reason)
  RETURN Response.json(draft)

FUNCTION handleVerifyTopic(req, name):
  { verifiedBy } = await req.json()
  kodexManager.verifyTopic(name, verifiedBy)
  topic = kodexManager.getTopic(name, false)
  RETURN Response.json(topic)

FUNCTION handleApproveDraft(req, name):
  topic = kodexManager.approveDraft(name)
  RETURN Response.json(topic)

FUNCTION handleRejectDraft(req, name):
  kodexManager.rejectDraft(name)
  RETURN Response.json({ message: "Draft rejected" })

FUNCTION handleGetDashboard(req):
  stats = kodexManager.getDashboardStats()
  RETURN Response.json(stats)
```
