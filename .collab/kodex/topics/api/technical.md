## Core API Routes (`src/routes/api.ts`)

### Session Registry (no project/session required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List all registered sessions |
| POST | `/api/sessions` | Register a session |
| DELETE | `/api/sessions` | Unregister a session |
| GET | `/api/health` | Server health check (uptime, services) |
| GET | `/api/status` | Agent status check |

### Diagram Routes (require `?project=...&session=...`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/diagrams` | List all diagrams |
| GET | `/api/diagram/:id` | Get diagram content |
| POST | `/api/diagram` | Create new diagram |
| POST | `/api/diagram/:id` | Update diagram |
| DELETE | `/api/diagram/:id` | Delete diagram |
| GET | `/api/render/:id` | Render diagram as SVG |
| GET | `/api/thumbnail/:id` | Generate thumbnail |
| POST | `/api/validate` | Validate Mermaid syntax |
| GET | `/api/transpile/:id` | Transpile SMACH to Mermaid |

### Document Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/documents` | List all documents |
| GET | `/api/document/:id` | Get document content |
| POST | `/api/document` | Create new document |
| POST | `/api/document/:id` | Update document |
| DELETE | `/api/document/:id` | Delete document |

### UI Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/render-ui` | Render UI (blocking/non-blocking) |
| POST | `/api/ui-response` | Submit user response to UI |
| POST | `/api/dismiss-ui` | Dismiss current UI |

### Terminal Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/terminal/sessions` | List terminal sessions |
| POST | `/api/terminal/sessions` | Create terminal session |
| DELETE | `/api/terminal/sessions/:id` | Kill terminal session |
| PUT | `/api/terminal/sessions/:id` | Rename terminal session |
| PUT | `/api/terminal/sessions/reorder` | Reorder sessions |

## Kodex API Routes (`src/routes/kodex-api.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kodex/topics` | List all topics |
| GET | `/api/kodex/topics/:name` | Get topic by name |
| GET | `/api/kodex/dashboard` | Get dashboard stats |
| GET | `/api/kodex/drafts` | List pending drafts |
| POST | `/api/kodex/drafts/:name/approve` | Approve draft |
| POST | `/api/kodex/drafts/:name/reject` | Reject draft |
| GET | `/api/kodex/flags` | List flags |
| POST | `/api/kodex/topics/:name/verify` | Verify topic |

## Response Patterns

- Success: `{ success: true, ... }`
- Error: `{ error: "message" }` with appropriate status code
- WebSocket broadcasts on mutations for real-time updates