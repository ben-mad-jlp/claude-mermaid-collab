# Collab Kodex

An MCP server that provides structured project knowledge to Claude Code, with AI-generated documentation and human-approved updates.

## Purpose

Prevent interpretation drift during AI-assisted development by giving Claude Code access to a curated, structured knowledge base about your project's architecture, conventions, and codebase.

---

## MCP Endpoints

### 1. Query Topic

**Endpoint:** `query_topic`

**Input:** Topic name (string)

**Returns:** Four documents for the requested topic:

| Document | Purpose |
|----------|---------|
| `conceptual.md` | High-level conceptual overview of the topic |
| `files.md` | List of files relevant to this topic |
| `technical.md` | Technical implementation details |
| `related.md` | Related topics and topics to avoid conflating |

**Also returns metadata:**
- Confidence tier (high/medium/low)
- Last modified date
- Last verified date
- Access count

**Side effect:** Logs the access (topic, timestamp) for analytics.

### 2. Flag Topic

**Endpoint:** `flag_topic`

**Input:**
- Topic name (string)
- Comment explaining the issue (string)

**Purpose:** Allows Claude Code to mark a topic for review when documentation is unclear, outdated, incomplete, or potentially incorrect.

**Side effect:** Creates a flag record with status "open".

### 3. List Topics (optional utility endpoint)

**Endpoint:** `list_topics`

**Returns:** All available topics with basic metadata (name, confidence, last verified).

---

## Storage Architecture

### Hybrid Approach

**Markdown files** for document content:
- Human-readable and editable
- Git-trackable with meaningful diffs
- Easy to review changes

**SQLite** for metadata:
- Access tracking and analytics
- Flag management
- Missing topic requests
- Generation context

### Folder Structure

```
kodex/
├── kodex.db                    # SQLite metadata database
├── topics/
│   ├── authentication/
│   │   ├── conceptual.md
│   │   ├── technical.md
│   │   ├── files.md
│   │   ├── related.md
│   │   └── draft/              # Pending approval
│   │       ├── conceptual.md
│   │       ├── technical.md
│   │       ├── files.md
│   │       └── related.md
│   ├── deployment/
│   │   ├── conceptual.md
│   │   ├── technical.md
│   │   ├── files.md
│   │   └── related.md
│   └── ...
```

### SQLite Schema

```sql
-- Topic registry
CREATE TABLE topics (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_modified_at DATETIME,
    last_verified_at DATETIME,
    confidence_tier TEXT CHECK(confidence_tier IN ('high', 'medium', 'low', 'unknown')) DEFAULT 'unknown',
    has_draft BOOLEAN DEFAULT FALSE
);

-- Access log for analytics
CREATE TABLE access_log (
    id INTEGER PRIMARY KEY,
    topic_id INTEGER REFERENCES topics(id),
    accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Aggregated access counts (updated periodically or on-demand)
CREATE TABLE access_counts (
    topic_id INTEGER PRIMARY KEY REFERENCES topics(id),
    total_count INTEGER DEFAULT 0,
    last_30_days INTEGER DEFAULT 0,
    last_accessed_at DATETIME
);

-- Missing topic requests
CREATE TABLE missing_topics (
    id INTEGER PRIMARY KEY,
    topic_name TEXT NOT NULL,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    request_count INTEGER DEFAULT 1,
    addressed BOOLEAN DEFAULT FALSE,
    addressed_at DATETIME
);

-- Flags for review
CREATE TABLE flags (
    id INTEGER PRIMARY KEY,
    topic_id INTEGER REFERENCES topics(id),
    comment TEXT NOT NULL,
    status TEXT CHECK(status IN ('open', 'addressed', 'resolved', 'dismissed')) DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    addressed_at DATETIME,
    resolved_at DATETIME
);

-- Generation context for drafts
CREATE TABLE generation_context (
    id INTEGER PRIMARY KEY,
    topic_id INTEGER REFERENCES topics(id),
    document_type TEXT CHECK(document_type IN ('conceptual', 'technical', 'files', 'related')),
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    trigger_type TEXT CHECK(trigger_type IN ('flag_response', 'missing_topic', 'scheduled_refresh', 'source_change', 'manual')),
    source_files TEXT,          -- JSON array of file paths used
    source_commit TEXT,         -- Git commit hash if applicable
    generation_notes TEXT       -- Any notes from the generation process
);
```

---

## Confidence System

### Confidence Tiers

| Tier | Meaning |
|------|---------|
| **High** | Recently verified, no open flags, actively maintained |
| **Medium** | Verified within reasonable timeframe, may have minor flags |
| **Low** | Stale (not verified recently), has unresolved flags, or newly generated |
| **Unknown** | New topic, never verified |

### Confidence Derivation

Confidence can be calculated from:
- Time since last verification
- Number of open flags
- Time since last modification
- Whether content was recently regenerated without verification

Example logic:
```
if last_verified < 7 days AND open_flags == 0:
    confidence = 'high'
elif last_verified < 30 days AND open_flags <= 1:
    confidence = 'medium'
elif last_verified > 30 days OR open_flags > 1:
    confidence = 'low'
else:
    confidence = 'unknown'
```

---

## Verification Workflow

### Verification Levels

| Level | Action | Effect |
|-------|--------|--------|
| **Quick verify** | "I glanced at this, looks fine" | Updates `last_verified_at` |
| **Deep review** | "I checked this against the codebase" | Updates `last_verified_at`, optionally add note |
| **Verified with changes** | Normal edit | Updates both `last_modified_at` and `last_verified_at` |

---

## Approval Workflow

### Draft Lifecycle

1. **Generation:** Maintenance AI creates/updates documents as drafts
2. **Pending:** Drafts exist in `topic/draft/` folder, `has_draft = true`
3. **Review:** Human reviews diff between current and draft
4. **Decision:**
   - **Approve:** Draft replaces current, dates updated, `has_draft = false`
   - **Reject:** Draft deleted, `has_draft = false`, optionally add note

### Draft States

- Current documents remain live and queryable
- Draft documents are not served by the MCP
- Human must explicitly approve for drafts to become current

---

## Flag Lifecycle

| Status | Meaning |
|--------|---------|
| **Open** | Claude Code raised the flag, not yet addressed |
| **Addressed** | Maintenance AI generated a draft in response |
| **Resolved** | Human approved the fix |
| **Dismissed** | Human decided flag wasn't valid (with optional reason) |

---

## Maintenance Workflows

### Maintenance AI Responsibilities

1. Process open flags → generate drafts addressing the issues
2. Process missing topic requests → generate new topic drafts
3. Check for source file changes → regenerate affected topic drafts
4. Scheduled refresh of stale topics

### Human Maintenance Session

Surfaces for review:

1. **Drafts pending approval** (with diffs)
2. **Flags dismissed by maintenance AI** (sanity check)
3. **Open flags not yet addressed** (may need human input)
4. **Stale topics** (not verified in X days, still being accessed)
5. **Hot topics** (high access count, may deserve deeper documentation)
6. **Dead topics** (no access in X days, archive candidates)

---

## Analytics Queries

### Most Accessed Topics (prioritize for depth)
```sql
SELECT t.name, ac.total_count, ac.last_30_days
FROM topics t
JOIN access_counts ac ON t.id = ac.topic_id
ORDER BY ac.last_30_days DESC
LIMIT 10;
```

### Stale but Active Topics (need verification)
```sql
SELECT t.name, t.last_verified_at, ac.last_30_days
FROM topics t
JOIN access_counts ac ON t.id = ac.topic_id
WHERE t.last_verified_at < datetime('now', '-30 days')
  AND ac.last_30_days > 5
ORDER BY ac.last_30_days DESC;
```

### Frequently Flagged Topics (documentation quality issues)
```sql
SELECT t.name, COUNT(f.id) as flag_count
FROM topics t
JOIN flags f ON t.id = f.topic_id
WHERE f.created_at > datetime('now', '-90 days')
GROUP BY t.id
HAVING flag_count > 2
ORDER BY flag_count DESC;
```

### Missing Topics (unmet demand)
```sql
SELECT topic_name, request_count, requested_at
FROM missing_topics
WHERE addressed = FALSE
ORDER BY request_count DESC;
```

### Dead Topics (archive candidates)
```sql
SELECT t.name, ac.last_accessed_at
FROM topics t
JOIN access_counts ac ON t.id = ac.topic_id
WHERE ac.last_accessed_at < datetime('now', '-60 days')
ORDER BY ac.last_accessed_at ASC;
```

---

## Implementation Notes

### MCP Server Technology

- Node.js or Python (both have good MCP SDK support)
- SQLite via `better-sqlite3` (Node) or `sqlite3` (Python)
- File system access for markdown documents

### Response Format

Query topic response example:
```json
{
  "topic": "authentication",
  "confidence": "high",
  "last_modified": "2025-01-20T10:30:00Z",
  "last_verified": "2025-01-22T14:00:00Z",
  "documents": {
    "conceptual": "# Authentication\n\nThis system uses JWT-based...",
    "technical": "# Authentication Technical Details\n\n## Token Flow...",
    "files": "# Authentication Files\n\n- src/auth/jwt.ts\n- src/middleware/auth.ts...",
    "related": "# Related Topics\n\n## Related\n- authorization\n- session-management\n\n## Do Not Confuse With\n- authorization (different concern)..."
  }
}
```

### Error Responses

- Topic not found → Log to `missing_topics`, return empty/error
- Database error → Return error with details
- File read error → Return partial response with available documents

---

---

# GUI Specification

A React-based maintenance interface for managing Collab Kodex.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Editor | CodeMirror with markdown mode |
| Data refresh | Manual (refresh button) |
| Bulk actions | No - single item operations only |
| Mobile support | Not a priority for v1 |
| Authentication | None - just a name field for audit trail |

---

## Views

### 1. Dashboard (Home)

The landing page showing what needs attention.

**Sections:**

- **Drafts Pending Approval** - count, list of topic names, click to review
- **Open Flags** - count, recent flags with topic and comment preview
- **Stale Topics** - topics accessed recently but not verified in X days
- **Missing Topic Requests** - topics Claude Code asked for that don't exist
- **Quick Stats** - total topics, accesses this week, overall health

**Actions:**
- Refresh button
- Click any item to navigate to relevant detail view

---

### 2. Topic Browser

List of all topics with filtering and sorting.

**Columns:**
- Topic name
- Confidence tier (badge: green/yellow/red/gray)
- Last verified date
- Access count (last 30 days)
- Open flag count
- Has draft (indicator)

**Filters:**
- Confidence tier (dropdown/checkboxes)
- Has open flags (toggle)
- Has pending draft (toggle)
- Stale only (not verified in X days)

**Sort options:**
- Name (alpha)
- Confidence
- Last verified
- Access count

**Actions:**
- Click row → Topic Detail
- "New Topic" button → Topic Editor (create mode)
- Refresh button

---

### 3. Topic Detail

Full view of a single topic.

**Header:**
- Topic name
- Confidence badge
- Last modified date
- Last verified date
- Access count

**Actions (header):**
- Verify (quick verify - updates last_verified_at)
- Edit → Topic Editor
- Delete (with confirmation)

**Document Tabs:**
- Conceptual
- Technical
- Files
- Related

Each tab shows rendered markdown (read-only).

**Draft Section (if draft exists):**
- Alert/banner: "Draft pending approval"
- Toggle: View Current | View Draft | View Diff
- Diff view with highlighting (additions green, removals red)
- Generation context panel:
  - Trigger type (flag response, missing topic, scheduled, manual)
  - Generated date
  - Source files used (if any)
  - Related flag comment (if applicable)
- Actions: Approve Draft | Reject Draft

**Flags Section:**
- List of flags for this topic
- Each flag shows: comment, status, created date
- Actions per flag:
  - Resolve (if open/addressed)
  - Dismiss with optional reason (if open)
  - Reopen (if resolved/dismissed)

---

### 4. Topic Editor

Edit or create topic documents.

**Header:**
- Topic name (editable if creating, read-only if editing)
- "Editing by" name field (free text, stored for audit)

**Layout:**
- Tab bar: Conceptual | Technical | Files | Related
- Each tab contains CodeMirror editor with markdown mode
- Optional: side-by-side preview panel (toggle)

**Actions:**
- Save (updates topic, sets last_modified_at)
- Save & Verify (updates topic, sets both last_modified_at and last_verified_at)
- Cancel (discard changes, return to detail or browser)

**Validation:**
- Topic name required and unique (on create)
- At least one document must have content

---

### 5. Flags View

Dedicated view for all flags across all topics.

**Tabs or filter:**
- All
- Open
- Addressed (draft generated)
- Resolved
- Dismissed

**List columns:**
- Topic name (link to topic detail)
- Comment (truncated with expand)
- Status (badge)
- Created date
- Addressed/resolved date (if applicable)

**Actions per flag:**
- Resolve
- Dismiss (with optional reason)
- Reopen
- Go to topic

**Filters:**
- Status
- Date range
- Topic (search/select)

---

### 6. Missing Topics View

Topics requested by Claude Code that don't exist.

**List columns:**
- Topic name
- Request count
- First requested date
- Last requested date

**Actions per item:**
- Create → Topic Editor (create mode, pre-filled name)
- Dismiss (marks as "not needed", removes from list)

---

## MCP Tools for GUI

These tools power the GUI's interaction with the Collab Kodex backend.

### Topic Management

```
list_topics
  Returns: Array of topics with metadata
  Params: 
    - filter_confidence?: string[]
    - filter_has_flags?: boolean
    - filter_has_draft?: boolean
    - filter_stale_days?: number
    - sort_by?: 'name' | 'confidence' | 'last_verified' | 'access_count'
    - sort_order?: 'asc' | 'desc'

get_topic
  Returns: Full topic with all documents and metadata
  Params:
    - topic_name: string

create_topic
  Returns: Created topic
  Params:
    - name: string
    - documents: { conceptual, technical, files, related }
    - edited_by: string

update_topic
  Returns: Updated topic
  Params:
    - topic_name: string
    - documents: { conceptual?, technical?, files?, related? }
    - edited_by: string
    - also_verify?: boolean

delete_topic
  Returns: Success/failure
  Params:
    - topic_name: string

verify_topic
  Returns: Updated topic
  Params:
    - topic_name: string
    - verified_by: string
```

### Draft Management

```
list_drafts
  Returns: Array of topics that have pending drafts
  Params: none

get_draft
  Returns: Draft documents and generation context
  Params:
    - topic_name: string

get_draft_diff
  Returns: Diff between current and draft for each document
  Params:
    - topic_name: string

approve_draft
  Returns: Updated topic (draft promoted to current)
  Params:
    - topic_name: string
    - approved_by: string

reject_draft
  Returns: Success (draft discarded)
  Params:
    - topic_name: string
    - rejected_by: string
    - reason?: string
```

### Flag Management

```
list_flags
  Returns: Array of flags with topic info
  Params:
    - filter_status?: string[]
    - filter_topic?: string
    - filter_date_from?: string
    - filter_date_to?: string

resolve_flag
  Returns: Updated flag
  Params:
    - flag_id: number
    - resolved_by: string

dismiss_flag
  Returns: Updated flag
  Params:
    - flag_id: number
    - dismissed_by: string
    - reason?: string

reopen_flag
  Returns: Updated flag
  Params:
    - flag_id: number
    - reopened_by: string
```

### Missing Topics

```
list_missing_topics
  Returns: Array of missing topic requests
  Params: none

dismiss_missing_topic
  Returns: Success
  Params:
    - topic_name: string
    - dismissed_by: string
```

### Dashboard / Stats

```
get_dashboard_stats
  Returns: 
    - pending_drafts_count: number
    - open_flags_count: number
    - stale_topics_count: number
    - missing_topics_count: number
    - total_topics: number
    - accesses_this_week: number

get_recent_flags
  Returns: Array of recent open flags (for dashboard)
  Params:
    - limit?: number (default 5)

get_stale_topics
  Returns: Array of stale topics sorted by access count
  Params:
    - stale_days?: number (default 30)
    - limit?: number (default 10)
```

---

## Component Structure

```
src/
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── Layout.tsx
│   │
│   ├── dashboard/
│   │   ├── Dashboard.tsx
│   │   ├── StatCard.tsx
│   │   ├── PendingDraftsList.tsx
│   │   ├── OpenFlagsList.tsx
│   │   └── StaleTopicsList.tsx
│   │
│   ├── topics/
│   │   ├── TopicBrowser.tsx
│   │   ├── TopicRow.tsx
│   │   ├── TopicDetail.tsx
│   │   ├── TopicEditor.tsx
│   │   ├── DocumentTabs.tsx
│   │   ├── DocumentViewer.tsx
│   │   ├── DraftReviewPanel.tsx
│   │   ├── DraftDiffViewer.tsx
│   │   └── ConfidenceBadge.tsx
│   │
│   ├── flags/
│   │   ├── FlagsView.tsx
│   │   ├── FlagsList.tsx
│   │   ├── FlagRow.tsx
│   │   └── FlagActions.tsx
│   │
│   ├── missing/
│   │   ├── MissingTopicsView.tsx
│   │   └── MissingTopicRow.tsx
│   │
│   └── common/
│       ├── MarkdownRenderer.tsx
│       ├── CodeMirrorEditor.tsx
│       ├── DiffViewer.tsx
│       ├── FilterBar.tsx
│       ├── RefreshButton.tsx
│       ├── ConfirmDialog.tsx
│       ├── NameInput.tsx          # "Edited by" field
│       └── StatusBadge.tsx
│
├── hooks/
│   ├── useTopics.ts
│   ├── useTopic.ts
│   ├── useFlags.ts
│   ├── useDrafts.ts
│   ├── useMissingTopics.ts
│   └── useDashboard.ts
│
├── services/
│   └── mcpClient.ts
│
├── pages/
│   ├── DashboardPage.tsx
│   ├── TopicBrowserPage.tsx
│   ├── TopicDetailPage.tsx
│   ├── TopicEditorPage.tsx
│   ├── FlagsPage.tsx
│   └── MissingTopicsPage.tsx
│
├── types/
│   └── index.ts
│
└── App.tsx
```

---

## Key User Flows

### Reviewing a Draft

1. Dashboard shows "3 drafts pending"
2. Click → navigates to first topic with draft
3. Topic Detail shows draft alert
4. Toggle to "View Diff" - see changes highlighted
5. Review generation context (why was this generated?)
6. Click "Approve Draft" → draft becomes current
7. If draft was for a flag, flag auto-resolves
8. Redirect to next pending draft or back to dashboard

### Quick Verification Sweep

1. Topic Browser → Filter: "Stale only"
2. Sort by access count (most used first)
3. Click first topic → Topic Detail
4. Scan rendered documents
5. Click "Verify" button in header
6. Back to browser, topic now shows updated verified date
7. Repeat for remaining stale topics

### Creating a Missing Topic

1. Missing Topics view shows "rate-limiting" (5 requests)
2. Click "Create" button
3. Topic Editor opens with name pre-filled
4. Write content in each tab (CodeMirror editors)
5. Fill in "Edited by" name
6. Click "Save & Verify"
7. Topic created, missing request auto-dismissed
8. Redirect to Topic Detail

### Handling a Flag

1. Flags View → filter by "Open"
2. See flag: topic "authentication", comment "Missing refresh token info"
3. Click topic link → Topic Detail
4. Review current docs, see what's missing
5. Option A: Click Edit, add the missing info, Save
6. Option B: If draft exists addressing this, approve it
7. Return to Flags View, click "Resolve" on the flag
8. Flag moves to Resolved status

---

## Future Considerations

- **Topic hierarchy:** Parent/child relationships for drilling down
- **Cross-references:** Automatic linking between related topics
- **Source file watching:** Auto-flag topics when source files change
- **Prompt templates:** Store generation prompts for consistency
- **Export endpoint:** "Give me everything flagged this week"
- **Bulk verification:** Quick-verify multiple topics in one pass
