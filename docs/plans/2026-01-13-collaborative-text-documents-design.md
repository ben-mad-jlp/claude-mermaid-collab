# Collaborative Text Documents Design

Add markdown document collaboration to the Mermaid collaboration server. Enables iterative text editing between user and Claude with inline comments and section-based approval.

## Overview

**Core workflow:**
1. Claude creates a document via MCP tool (e.g., during brainstorming)
2. User opens it at `http://localhost:3737/document.html?id=<id>`
3. User edits text, adds comments, approves/rejects sections
4. Claude reads document including edits, comments, and status markers
5. Claude updates, user reviews - repeat until done

**File storage:** `.md` files in `documents/` folder (parallel to `diagrams/`).

**Real-time sync:** Same WebSocket infrastructure as diagrams.

## Document Format

Comments and status stored as HTML comments within the markdown:

```markdown
## Architecture
<!-- status: approved -->

The system uses a two-server model with shared WebSocket infrastructure.

## Data Flow
<!-- status: rejected -->
<!-- comment: Should we use event sourcing instead? -->

Data flows through the REST API.

This handles <!-- comment-start: Is 1000 too low? -->up to 1000 concurrent users<!-- comment-end --> efficiently.
```

**Markers:**
- `<!-- status: approved -->` or `<!-- status: rejected -->` - After a heading, applies to that section
- `<!-- comment: text -->` - Standalone comment at a location
- `<!-- comment-start: text -->...<!-- comment-end -->` - Wraps selected text with inline comment

## Editor UI

**Layout:** Split pane matching diagram editor.

- Left pane: Raw markdown textarea
- Resizer: Draggable divider
- Right pane: Rendered preview with visual status/comment display

**Toolbar:**
- Back button
- Document title
- Comment button - Wraps selection or inserts standalone comment
- Approve button - Inserts approved status after nearest heading
- Reject button - Inserts rejected status after nearest heading
- Export dropdown: "Export Clean" (strips markers), "Export Raw" (as-is)
- Connection status indicator

**Preview rendering:**
- Markdown rendered with `marked` library
- Custom post-processing for comment/status markers
- Approved sections: green left border
- Rejected sections: red/orange left border
- Inline comments: highlighted text with tooltip
- Standalone comments: callout box

**Synchronized scrolling:** Scroll position linked between panes.

## API Endpoints

```
GET  /api/documents          - List all documents
GET  /api/document/:id       - Get document content
POST /api/document           - Create document { name, content }
POST /api/document/:id       - Update document { content }
DELETE /api/document/:id     - Delete document
GET  /api/document/:id/clean - Get content with markers stripped
```

## MCP Tools

- `list_documents()` - List all documents
- `get_document(id)` - Read document including markers
- `create_document(name, content)` - Create and return preview URL
- `update_document(id, content)` - Update document
- `preview_document(id)` - Get browser URL

## WebSocket Events

- `document:created` - New document added
- `document:updated` - Document content changed
- `document:deleted` - Document removed

## Dashboard Changes

Combined view showing diagrams and documents together:
- Filter dropdown: "All" | "Diagrams" | "Documents"
- Type indicator icon on each card
- Documents show first ~100 chars or first heading as preview
- Sorted by modification date

## Implementation

**Files to add:**

```
documents/                       # Storage folder
public/document.html            # Editor page
public/js/document-editor.js    # Editor logic
src/services/document-manager.ts # CRUD service
```

**Files to modify:**

- `src/server.ts` - Document routes
- `src/routes/api.ts` - Document API endpoints
- `src/websocket/handler.ts` - Document events
- `src/mcp/server.ts` - Document MCP tools
- `src/services/file-watcher.ts` - Watch documents folder
- `public/index.html` - Dashboard combined view with filter

**Dependencies:**

- `marked` - Markdown renderer
