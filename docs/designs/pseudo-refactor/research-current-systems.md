# Research: Current Systems — Kodex, Pseudo, Onboarding

## 1. Kodex — Project Knowledge Base

### Purpose
Kodex is a structured knowledge base that stores project documentation as **topics**. Each topic covers a logical area of the codebase (e.g., "authentication", "deployment", "api"). It supports a draft/approval workflow so AI-generated content requires human review before going live.

### Data Storage
- **SQLite database**: `.collab/kodex/kodex.db` — stores topic metadata, flags, access logs, missing topic tracking, generation context
- **Markdown files**: `.collab/kodex/topics/{topic-name}/` — each topic has up to 5 markdown files:
  - `conceptual.md` — high-level explanation
  - `technical.md` — implementation details
  - `files.md` — relevant source files
  - `related.md` — links to related topics
  - `diagrams.md` — mermaid diagram references
- **Draft workflow**: drafts are stored in `{topic-name}/draft/` subdirectory; approval moves them to the live directory

### Key Types
- **TopicContent**: `{ conceptual, technical, files, related, diagrams }`
- **TopicMetadata**: name, title, confidence (low/medium/high), verified flag, aliases, timestamps
- **Flags**: outdated, incorrect, incomplete, missing, needs-review (with open/resolved/dismissed status)
- **Draft**: staged content awaiting human approval

### Backend Services
| File | Role |
|------|------|
| `src/services/kodex-manager.ts` | Core CRUD — topics, drafts, flags, aliases, analytics |
| `src/routes/kodex-api.ts` | REST API at `/api/kodex/*` |

### UI Pages
| File | Route | Purpose |
|------|-------|---------|
| `ui/src/pages/kodex/KodexLayout.tsx` | `/kodex` | Layout wrapper |
| `ui/src/pages/kodex/Dashboard.tsx` | `/kodex` (index) | Stats overview |
| `ui/src/pages/kodex/Topics.tsx` | `/kodex/topics` | Topic list |
| `ui/src/pages/kodex/TopicDetail.tsx` | `/kodex/topics/:name` | Single topic view |
| `ui/src/pages/kodex/Drafts.tsx` | `/kodex/drafts` | Pending drafts |
| `ui/src/pages/kodex/Flags.tsx` | `/kodex/flags` | Flagged topics |
| `ui/src/pages/kodex/Graph.tsx` | `/kodex/graph` | Topic relationship graph |
| `ui/src/components/kodex/KodexSidebar.tsx` | — | Sidebar navigation |
| `ui/src/components/kodex/ProjectSelector.tsx` | — | Shared project picker |
| `ui/src/stores/kodexStore.ts` | — | Zustand store |
| `ui/src/lib/kodex-api.ts` | — | API client |

### MCP Tools (Claude interface)
kodex_create_topic, kodex_query_topic, kodex_list_topics, kodex_flag_topic, kodex_dashboard, kodex_list_flags, kodex_list_drafts, kodex_approve_draft, kodex_reject_draft, kodex_update_topic, kodex_verify_topic, kodex_add_alias, kodex_remove_alias, kodex_direct_create_topic, kodex_direct_update_topic

### Skills (10 total)
| Skill | Purpose |
|-------|---------|
| `kodex-init` | Bootstrap knowledge base by analyzing codebase structure |
| `using-kodex` | Query topics during work, flag outdated ones |
| `kodex-fix` | Fix flagged topics |
| `kodex-fix-incomplete` | Fill in stub topics |
| `kodex-fix-incorrect` | Correct factual errors |
| `kodex-fix-missing` | Create topics for missing documentation |
| `kodex-fix-outdated` | Update stale topics |
| `kodex-bootstrap-missing` | Convert all missing flags to stub topics |
| `kodex-generate-aliases` | Generate searchable aliases |
| `kodex-sync-session` | Sync collab session artifacts into Kodex |

---

## 2. Pseudo — Pseudocode Documentation System

### Purpose
Every non-trivial code file gets a sibling `.pseudo` file that captures the file's intent and logic in plain English. The code is the source of truth; the pseudocode is a readable summary that stays in sync.

### Data Storage
- **`.pseudo` files**: sibling to each code file (e.g., `server.ts` -> `server.pseudo`)
- **No database**: purely file-based
- **Sync tracking files**:
  - `.pseudo-sync` — timestamp of last global sync
  - `.pseudo-needs-update` — manifest of files changed since last sync (written by git hook)

### File Format (from PSEUDOCODE_SPEC.md)
```
// Short title
// Purpose description
// synced: 2026-03-26T14:30:00Z

Module-level context in plain prose.

FUNCTION functionName(params) -> returnType                EXPORT [YYYY-MM-DD]
  CALLS: otherFunc (other-file), Constructor (module)
  Plain English description of what the function does.
  1. Step one
  2. Step two
  IF condition, do X. ELSE do Y.

---

FUNCTION anotherFunction(params)                           [YYYY-MM-DD]
  Description...
```

Key format rules:
- `FUNCTION` blocks with `[YYYY-MM-DD]` date tracking per function
- `EXPORT` marker for public API functions
- `CALLS:` annotations for cross-file dependencies (enables navigable links)
- `---` separators between blocks
- 30-second rule: must be understandable in 30 seconds

### Skip Rules
- Index/barrel files (only re-exports)
- Pure type/interface files
- Test files
- Config files
- Files under 20 lines

### Commit Tracking (git hook integration)
- `scripts/post-commit` — git hook
- `scripts/pseudo-track-commit.sh` — writes changed source files to `.pseudo-needs-update` manifest
- `scripts/pseudo-hook-check.sh` — Claude Code PostToolUse hook for tracking Claude-initiated commits

### Backend Services
| File | Role |
|------|------|
| `src/routes/pseudo-api.ts` | REST API at `/api/pseudo/*` — list files, get file content, search, find references |

### API Endpoints
- `GET /api/pseudo/files?project=X` — list all .pseudo files
- `GET /api/pseudo/file?project=X&file=Y` — get single file content (with basename fallback)
- `GET /api/pseudo/search?project=X&q=Y` — full-text search across all pseudo files
- `GET /api/pseudo/references?project=X&functionName=Y&fileStem=Z` — find callers of a function (reverse CALLS lookup)

### UI Pages
| File | Route | Purpose |
|------|-------|---------|
| `ui/src/pages/pseudo/PseudoPage.tsx` | `/pseudo/*` | Top-level layout: file tree + viewer + jump panel |
| `ui/src/pages/pseudo/PseudoFileTree.tsx` | — | Left sidebar file tree |
| `ui/src/pages/pseudo/PseudoViewer.tsx` | — | Main content viewer |
| `ui/src/pages/pseudo/PseudoBlock.tsx` | — | Renders individual FUNCTION blocks |
| `ui/src/pages/pseudo/FunctionJumpPanel.tsx` | — | Right sidebar function index |
| `ui/src/pages/pseudo/PseudoSearch.tsx` | — | Search overlay (Cmd+K) |
| `ui/src/pages/pseudo/CallsLink.tsx` | — | Clickable CALLS cross-references |
| `ui/src/pages/pseudo/CallsPopover.tsx` | — | Popover for CALLS details |
| `ui/src/pages/pseudo/parsePseudo.ts` | — | Parser for .pseudo file format |
| `ui/src/pages/pseudo/tree.utils.ts` | — | File tree building utilities |
| `ui/src/lib/pseudo-api.ts` | — | API client |

### Skill
| Skill | Purpose |
|-------|---------|
| `pseudocode` | Generate/update/sync .pseudo files. Subcommands: (no args), specific file, directory, "all", "sync", "install" |

---

## 3. Onboarding — Kodex-Based Learning System

### Purpose
Onboarding is a **consumer-facing layer on top of Kodex** that helps new team members explore and learn a codebase. It adds user accounts, progress tracking, full-text search, and category-based browsing to Kodex's topic data.

### Relationship to Kodex
- **Reads from Kodex**: uses `getKodexManager()` to access topics, does NOT have its own topic storage
- **Adds its own data layer**: user progress, notes, FTS5 search index, team dashboards
- **Wraps Kodex with UX**: categories derived from topic name prefixes, topic relationship graphs, browse/onboard mode toggle

### Data Storage
- **SQLite databases** at `{project}/.collab/onboarding/`:
  - `index.db` — FTS5 full-text search over Kodex topic content (auto-rebuilds when topic files change)
  - `progress.db` — users, progress tracking, notes, learning path progress
- **Optional config**: `kodex-onboarding.json` at project root for title, categories, learning paths

### Backend Services
| File | Role |
|------|------|
| `src/services/onboarding-manager.ts` | Config, categories, topic graph, diagram extraction — wraps KodexManager |
| `src/services/onboarding-db.ts` | FTS5 search index + progress/notes/team SQLite |
| `src/routes/onboarding-api.ts` | REST API at `/api/onboarding/*` |

### API Endpoints
- `GET /config` — project title, topic count, default mode, categories, paths
- `GET /categories` — category list derived from topic name prefixes
- `GET /graph` — nodes + edges for topic relationship visualization
- `GET /topics` — delegates to KodexManager
- `GET /topics/:name` — delegates to KodexManager
- `GET /topics/:name/diagram` — mermaid diagrams for a topic
- `GET /search?q=X` — FTS5 search
- Users: `GET/POST /users`, `GET /users/:id`
- Progress: `GET/POST/DELETE /progress/:userId/:topic`
- Notes: `GET/POST /notes/:userId/:topic`, `PUT/DELETE /notes/:id`
- Team: `GET /team`

### UI Pages
| File | Route | Purpose |
|------|-------|---------|
| `ui/src/pages/onboarding/OnboardingLayout.tsx` | `/onboarding` | Layout with browse/onboard mode toggle, sidebar nav |
| `ui/src/pages/onboarding/BrowseDashboard.tsx` | `/onboarding` (index) | Topic list with category filters |
| `ui/src/pages/onboarding/TopicDetail.tsx` | `/onboarding/topic/:name` | Single topic view with notes |
| `ui/src/pages/onboarding/TopicGraph.tsx` | `/onboarding/graph` | Interactive relationship graph |
| `ui/src/pages/onboarding/SearchResults.tsx` | `/onboarding/search` | Search results page |
| `ui/src/pages/onboarding/WelcomeScreen.tsx` | `/onboarding/welcome` | User login/creation |
| `ui/src/pages/onboarding/OnboardingDashboard.tsx` | `/onboarding/dashboard` | Progress dashboard (onboard mode) |
| `ui/src/pages/onboarding/TeamDashboard.tsx` | `/onboarding/team` | Team progress view |
| `ui/src/pages/onboarding/DiagramsTab.tsx` | — | Diagram viewer tab |
| `ui/src/lib/onboarding-api.ts` | — | API client |

### Two Modes
1. **Browse mode** (default): Anyone can browse topics by category, view topic graphs, search
2. **Onboard mode**: Requires user identity (via WelcomeScreen), adds progress tracking, notes, personal dashboard, team view

---

## 4. Cross-System Relationships

```
┌─────────────────────────────────────────────────┐
│                    Kodex                         │
│  .collab/kodex/kodex.db (metadata)              │
│  .collab/kodex/topics/{name}/*.md (content)     │
│  10 skills for Claude interaction               │
│  Full CRUD via MCP tools                        │
└──────────────┬──────────────────────────────────┘
               │ reads from (getKodexManager)
               │
┌──────────────▼──────────────────────────────────┐
│                 Onboarding                       │
│  .collab/onboarding/index.db (FTS5 search)      │
│  .collab/onboarding/progress.db (user data)     │
│  Wraps Kodex topics with UX for learning        │
│  No own topic storage — purely a consumer       │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│                   Pseudo                         │
│  *.pseudo files (sibling to code files)         │
│  .pseudo-sync, .pseudo-needs-update (tracking)  │
│  Independent system — no Kodex dependency       │
│  1 skill for Claude interaction                 │
└─────────────────────────────────────────────────┘
```

### Shared Infrastructure
- All three use the same `ProjectSelector` component and `kodexStore` for project selection
- All three are registered as routes in `ui/src/main.tsx`
- All three have API routes mounted in `src/server.ts`
- Collab sessions auto-sync project selection across kodex/onboarding/pseudo (App.tsx)

### Key Observation
- **Kodex and Onboarding are tightly coupled**: Onboarding is a read-only consumer of Kodex data with its own user/progress layer
- **Pseudo is fully independent**: no dependency on Kodex or Onboarding; purely file-based with its own UI, API, and skill
