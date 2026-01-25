# Collab Kodex Integration Design

**Session:** smooth-pure-island  
**Goal:** Integrate Collab Kodex into mermaid-collab as a unified platform  
**Architecture:** Single Server, Separate UI Sections ✓

---

## Architecture Decision

**Chosen: Single Server, Separate UI Sections**
- One server on port 3737
- One MCP with all tools (Collab + Kodex)
- Separate UI sections with cross-links
- Consistent visual styling (same design system)
- No component sharing required

**UI Navigation:**
- `/` - Collab section (existing)
- `/kodex` - Kodex section (new)
- Cross-links between sections in headers/sidebars

See: `architecture` diagram

---

## Work Items

### Item 1: Add Kodex MCP tools
**Type:** code
**Status:** documented

**Problem/Goal:**
Claude Code needs MCP tools to query project knowledge (Kodex) and flag issues. Humans need tools (via GUI) to manage topics, verify content, and approve drafts.

**Approach:**
Add all Kodex tools to the existing MCP server with `kodex_` prefix. Tools call REST API endpoints internally (same pattern as existing diagram/document tools).

**Tools:**
| Tool | Purpose | Primary User |
|------|---------|--------------|
| `kodex_query_topic` | Get topic docs + metadata | Claude Code |
| `kodex_flag_topic` | Flag topic for review | Claude Code |
| `kodex_list_topics` | List all topics | Both |
| `kodex_create_topic` | Create new topic (as draft) | Both |
| `kodex_update_topic` | Update topic (as draft) | Both |
| `kodex_verify_topic` | Mark topic verified | Human/GUI |
| `kodex_list_drafts` | List pending drafts | Human/GUI |
| `kodex_approve_draft` | Approve draft → live | Human/GUI |
| `kodex_reject_draft` | Reject/delete draft | Human/GUI |

**Success Criteria:**
- All 9 tools registered in MCP and callable
- Tools return proper JSON responses
- Error handling follows existing patterns
- Tools call `/api/kodex/*` endpoints

**Decisions:**
1. **Single MCP** - All tools in one MCP with `kodex_` prefix (no separation)
2. **Query returns full content** - `include_content` param (default: true) for flexibility
3. **Always draft** - `create_topic` and `update_topic` always create drafts requiring human approval
4. **Missing topics logged** - Query for non-existent topic returns empty + logs to `missing_topics` table for analytics

### Item 2: Create Kodex service layer
**Type:** code
**Status:** documented

**Problem/Goal:**
Need a service layer to manage Kodex data: SQLite database for metadata/tracking and markdown files for topic content. Must handle topic CRUD, drafts, flags, access tracking, and missing topic logging.

**Approach:**
Create `src/services/kodex-manager.ts` with:
- SQLite initialization (6 tables from spec)
- Topic CRUD with markdown file I/O
- Draft lifecycle (create draft → approve/reject)
- Flag management with status tracking
- Access logging for analytics
- Missing topic tracking

**Database Tables (from spec):**
| Table | Purpose |
|-------|---------|
| `topics` | Topic metadata, timestamps, confidence |
| `access_log` | Per-access tracking with timestamps |
| `access_counts` | Aggregated counts per topic |
| `missing_topics` | Requested but non-existent topics |
| `flags` | Issue tracking with status |
| `generation_context` | Topic generation metadata |

**Success Criteria:**
- All 6 SQLite tables created on init
- CRUD operations work for topics
- Draft workflow: create → list → approve/reject
- Flags can be created, listed, updated
- Access logged on every query
- Missing topics logged when queried

**Decisions:**
1. **Unified `.collab/` folder** - Both sessions and Kodex live under `.collab/`:
   ```
   .collab/
   ├── sessions/           # Sessions moved here
   │   └── <session-name>/
   └── kodex/              # Kodex data
       ├── kodex.db
       └── topics/
   ```
2. **Lazy initialization** - Database created on first access, not server start
3. **File-based content** - Topic content in markdown files (not in SQLite) for easy editing/versioning
4. **Draft as separate folder** - `topics/<name>/draft/` contains pending changes

### Item 3: Add Kodex API routes
**Type:** code
**Status:** documented

**Problem/Goal:**
Need REST API endpoints for the UI and MCP tools to interact with Kodex. Endpoints must support topic CRUD, flag management, draft workflow, and dashboard stats.

**Approach:**
Create `src/routes/kodex-api.ts` with dedicated Kodex routes. Keep separate from existing `api.ts` for clarity. All routes use KodexManager service.

**Endpoints:**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/kodex/topics` | List all topics with metadata |
| GET | `/api/kodex/topics/:name` | Get topic content + metadata |
| POST | `/api/kodex/topics` | Create topic (as draft) |
| PUT | `/api/kodex/topics/:name` | Update topic (as draft) |
| DELETE | `/api/kodex/topics/:name` | Delete topic |
| POST | `/api/kodex/topics/:name/verify` | Mark topic verified |
| GET | `/api/kodex/flags` | List all flags |
| POST | `/api/kodex/topics/:name/flag` | Flag topic for review |
| PUT | `/api/kodex/flags/:id` | Update flag status |
| GET | `/api/kodex/drafts` | List pending drafts |
| POST | `/api/kodex/drafts/:name/approve` | Approve draft → live |
| POST | `/api/kodex/drafts/:name/reject` | Reject/delete draft |
| GET | `/api/kodex/dashboard` | Dashboard stats |
| GET | `/api/kodex/missing` | List missing topic requests |

**Success Criteria:**
- All 14 endpoints implemented and functional
- Proper HTTP status codes (200, 201, 400, 404, 500)
- JSON responses with consistent structure
- Error messages are helpful for debugging

**Decisions:**
1. **Separate file** - `kodex-api.ts` keeps routes organized and easy to maintain
2. **RESTful design** - Standard REST patterns for predictable API
3. **Dashboard endpoint** - Single endpoint for dashboard stats (not multiple small endpoints)
4. **Missing topics endpoint** - Exposes analytics data for identifying knowledge gaps

### Item 4: Create Kodex UI section
**Type:** code
**Status:** documented

**Problem/Goal:**
Need a dedicated UI section for humans to manage Kodex: browse topics, review drafts, handle flags, and view dashboard analytics. Must feel like part of the same app as Collab.

**Approach:**
Create `/kodex` route with dedicated pages and layout. Use same Tailwind styling as Collab. Pages communicate with backend via REST API.

**Pages:**
| Route | Page | Purpose |
|-------|------|---------|
| `/kodex` | Dashboard | Overview stats, recent activity, pending drafts |
| `/kodex/topics` | TopicBrowser | Searchable list of all topics |
| `/kodex/topics/:name` | TopicDetail | View topic content + metadata |
| `/kodex/topics/:name/edit` | TopicEditor | Edit topic content (creates draft) |
| `/kodex/flags` | Flags | List/manage flagged topics |
| `/kodex/drafts` | DraftReview | Review pending drafts, approve/reject |
| `/kodex/missing` | MissingTopics | View requested but missing topics |

**Components:**
| Component | Purpose |
|-----------|---------|
| `KodexLayout` | Sidebar + header wrapper |
| `KodexSidebar` | Navigation links |
| `TopicCard` | Topic summary card |
| `TopicList` | Filterable topic list |
| `TopicContent` | Renders 4 markdown sections |
| `FlagList` | List of flags with status |
| `FlagCard` | Single flag details |
| `DraftDiff` | Side-by-side draft comparison |
| `ConfidenceBadge` | Shows confidence level |
| `MetadataPanel` | Topic metadata display |

**Success Criteria:**
- All 7 pages render and function correctly
- Navigation between pages works
- API calls succeed and display data
- Forms submit correctly
- Same visual style as Collab section

**Decisions:**
1. **Separate layout** - KodexLayout independent from Collab (simpler, no shared state)
2. **Dashboard as landing** - `/kodex` shows dashboard, not topic list
3. **Draft diff view** - Show side-by-side comparison when reviewing drafts
4. **Confidence badge** - Visual indicator of topic confidence (low/medium/high)

### Item 5: Add cross-links between sections
**Type:** code  
**Status:** documented

**Problem/Goal:**
Users need easy navigation between Collab and Kodex sections. Currently separate but should feel like one unified app with two sections.

**Approach:**
Add cross-links in sidebars/headers of both sections. Simple approach - just add links, no shared navigation component needed.

**Changes:**
| Location | Change |
|----------|--------|
| Collab sidebar | Add "Kodex" link at bottom |
| Kodex sidebar | Add "Collab" link at bottom |
| Both headers | Add subtle section indicator |

**Success Criteria:**
- Can navigate from Collab to Kodex in one click
- Can navigate from Kodex to Collab in one click
- Current section is visually indicated
- Links work from any page in either section

**Decisions:**
1. **Sidebar links** - Cross-links in sidebar (not top nav bar) to keep UI simple
2. **No shared nav** - Each section has its own nav, just with a link to the other
3. **Visual indicator** - Current section shown in header (e.g., "Collab" or "Kodex" badge)

---

## File Structure

```
src/
├── services/
│   ├── kodex-manager.ts      # NEW: Kodex business logic + SQLite
│   └── ...existing...
├── mcp/
│   ├── setup.ts              # MODIFY: Add Kodex tools
│   └── tools/
│       └── kodex.ts          # NEW: Kodex tool handlers
├── routes/
│   ├── api.ts                # Existing Collab API
│   └── kodex-api.ts          # NEW: Kodex API routes

ui/src/
├── App.tsx                   # MODIFY: Add /kodex routes
├── pages/
│   └── kodex/                # NEW: Kodex pages
│       ├── KodexLayout.tsx   # Kodex-specific layout
│       ├── Dashboard.tsx
│       ├── TopicBrowser.tsx
│       ├── TopicDetail.tsx
│       ├── TopicEditor.tsx
│       ├── Flags.tsx
│       └── DraftReview.tsx
├── components/
│   └── kodex/                # NEW: Kodex-specific components
│       ├── TopicCard.tsx
│       ├── TopicList.tsx
│       ├── FlagList.tsx
│       ├── DraftDiff.tsx
│       ├── ConfidenceBadge.tsx
│       └── KodexSidebar.tsx

.collab/                      # RESTRUCTURED: All collab data
├── sessions/                 # Sessions moved here
│   └── <session-name>/
│       ├── diagrams/
│       ├── documents/
│       └── collab-state.json
└── kodex/                    # NEW: Kodex data
    ├── kodex.db              # SQLite database
    └── topics/
        └── <topic-name>/
            ├── conceptual.md
            ├── technical.md
            ├── files.md
            ├── related.md
            └── draft/        # Pending approval
```

---

## Migration: Folder Restructure

The new folder structure moves sessions into `.collab/sessions/`. This requires:

1. **Update session discovery** - Look for sessions in `.collab/sessions/` instead of `.collab/`
2. **Update MCP tools** - Session paths change from `.collab/<name>/` to `.collab/sessions/<name>/`
3. **Backwards compatibility** - Detect old structure and migrate or support both temporarily

**Migration approach:** Support both old and new paths during transition. On first access, offer to migrate old sessions to new location.

---

## Visual Consistency

Both sections use:
- Same Tailwind config (colors, spacing, fonts)
- Same card/panel styling
- Same button styles
- Same table styling
- Same form inputs

Different but consistent:
- Kodex has its own sidebar items
- Kodex has its own dashboard layout
- Each section feels like part of the same app

---

## Diagrams

- `architecture` - System architecture overview
