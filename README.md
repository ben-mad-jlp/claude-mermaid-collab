# Mermaid Collab

A collaborative design toolkit for Claude Code: diagram server + skills for design-to-implementation workflows.

**Two components:**
1. **Server** - Real-time Mermaid diagram collaboration with MCP integration
2. **Plugin** - Skills for brainstorming, planning, and structured development workflows

## Features

### Server

- **Multi-Session Architecture**: One server serves multiple projects and sessions
- **Session Selector**: Dashboard dropdown to switch between projects/sessions
- **Scratch Session**: Default workspace for casual use (auto-created on startup)
- **Web Dashboard**: Browse diagrams with cached thumbnails, search, and filter
- **Folder Organization**: Organize diagrams and documents into folders
- **Item Locking**: Lock items to prevent accidental deletion
- **Split-Pane Editor**: Live preview with syntax validation, undo/redo
- **Real-Time Collaboration**: WebSocket-based live updates
- **MCP Integration**: Claude Code can create, read, update, and preview diagrams
- **Wireframe Plugin**: Built-in support for UI wireframes and mockups
- **SMACH Transpiler**: Convert ROS SMACH state machine YAML to flowcharts
- **Document Collaboration**: Create and edit markdown documents alongside diagrams

### Skills

- **brainstorming** - Socratic design refinement with live diagram creation
- **collab** - Full design-to-implementation pipeline with state persistence
- **rough-draft** - 4-phase refinement: interfaces → pseudocode → skeleton → handoff
- **writing-plans** - Detailed implementation plans with bite-sized tasks
- **executing-plans** - Batch execution with human checkpoints
- **subagent-driven-development** - Fast iteration with two-stage review
- **test-driven-development** - RED-GREEN-REFACTOR cycle enforcement
- **systematic-debugging** - 4-phase root cause analysis
- **verification-before-completion** - Evidence before success claims
- **using-git-worktrees** - Parallel development branches
- **finishing-a-development-branch** - Merge/PR decision workflow
- **requesting-code-review** / **receiving-code-review** - Code review workflows

## Quick Start

### 1. Install Server

```bash
git clone https://github.com/ben-mad-jlp/claude-mermaid-collab.git
cd claude-mermaid-collab
bun install
```

### 2. Start Server

```bash
# Start server in background
bun run bin/mermaid-collab.ts start

# Check status
bun run bin/mermaid-collab.ts status

# Stop server
bun run bin/mermaid-collab.ts stop
```

Or add to your PATH for convenience:
```bash
alias mermaid-collab="bun run /path/to/claude-mermaid-collab/bin/mermaid-collab.ts"
```

The server runs at `http://localhost:3737` and serves all sessions.

### 3. Install Plugin (Claude Code)

```bash
# In Claude Code, install the plugin
/plugin install ben-mad-jlp/claude-mermaid-collab
```

After installation, skills activate automatically. Start with `/collab` or just describe what you want to build.

### 4. Open Dashboard

Open http://localhost:3737 in your browser. Select a session from the dropdown to view its diagrams and documents.

## Collab Workflow

The collab workflow turns ideas into working code through structured phases:

```
/collab → brainstorming → rough-draft → implementation → cleanup
```

1. **Start a collab** - Run `/collab`, pick a template (feature, bugfix, refactor, spike)
2. **Brainstorm** - Create design doc with goals, decisions, diagrams, success criteria
3. **Rough-draft** - Progress through: interfaces → pseudocode → skeleton → handoff
4. **Execute** - Tasks run with verification gates at each step
5. **Cleanup** - Artifacts archived, collab folder removed

Each phase creates live diagrams and documents you can view in the dashboard.

## Sessions

The server supports multiple projects and sessions:

- **Project**: A directory containing a `.collab/` folder (e.g., your code repository)
- **Session**: A named workspace within a project (e.g., `bright-calm-river`)

### Session Storage

```
~/.mermaid-collab/
├── sessions.json       # Registry of all sessions
├── server.pid          # Server process ID
├── server.log          # Server logs
└── .collab/
    └── scratch/        # Default scratch session
        ├── diagrams/
        └── documents/

/your/project/
└── .collab/
    └── session-name/
        ├── diagrams/
        ├── documents/
        └── collab-state.json
```

### Scratch Session

A default "scratch" session is auto-created at `~/.mermaid-collab/.collab/scratch/` when the server starts. Use this for quick diagrams without setting up a full collab session.

## MCP Tools (for Claude Code)

All tools require `project` (absolute path) and `session` (session name) parameters.

### Session Management

| Tool | Description |
|------|-------------|
| `generate_session_name()` | Generate a memorable session name |
| `list_sessions()` | List all registered sessions |

### Diagram Tools

| Tool | Description |
|------|-------------|
| `list_diagrams(project, session)` | List all diagrams |
| `get_diagram(project, session, id)` | Get diagram content |
| `create_diagram(project, session, name, content)` | Create new diagram |
| `update_diagram(project, session, id, content)` | Update diagram |
| `validate_diagram(content)` | Check Mermaid syntax |
| `preview_diagram(project, session, id)` | Get browser URL |

### Document Tools

| Tool | Description |
|------|-------------|
| `list_documents(project, session)` | List all documents |
| `get_document(project, session, id)` | Get document content |
| `create_document(project, session, name, content)` | Create new document |
| `update_document(project, session, id, content)` | Update document |
| `preview_document(project, session, id)` | Get browser URL |

## REST API

All endpoints require `?project=...&session=...` query parameters (except `/api/sessions`).

### Sessions

```bash
# List all sessions
GET /api/sessions

# Register a session
POST /api/sessions
{"project": "/path/to/project", "session": "session-name"}

# Unregister a session
DELETE /api/sessions
{"project": "/path/to/project", "session": "session-name"}
```

### Diagrams

```bash
# List diagrams
GET /api/diagrams?project=/path&session=name

# Get diagram
GET /api/diagram/:id?project=/path&session=name

# Create diagram
POST /api/diagram?project=/path&session=name
{"name": "my-diagram", "content": "graph TD\n  A-->B"}

# Update diagram
POST /api/diagram/:id?project=/path&session=name
{"content": "graph TD\n  A-->B-->C"}

# Delete diagram
DELETE /api/diagram/:id?project=/path&session=name
```

### Documents

```bash
# List documents
GET /api/documents?project=/path&session=name

# Get document
GET /api/document/:id?project=/path&session=name

# Create document
POST /api/document?project=/path&session=name
{"name": "design", "content": "# My Design\n\n..."}

# Update document
POST /api/document/:id?project=/path&session=name
{"content": "# Updated Design\n\n..."}

# Delete document
DELETE /api/document/:id?project=/path&session=name
```

## Configuration

```bash
PORT=3737   # Server port (default: 3737)
HOST=0.0.0.0  # Bind address (default: 0.0.0.0)
```

## Wireframe Plugin

Create UI wireframes with text-based syntax:

```
wireframe mobile TD
  screen "Login Screen"
    col padding=16
      Title "Welcome Back"
      Input "Email"
      Input "Password"
      Button "Sign In" primary
```

See [plugins/wireframe/README.md](plugins/wireframe/README.md) for full documentation.

## SMACH Transpiler

Visualize ROS SMACH state machines as interactive flowcharts:

```yaml
smach_diagram:
  MyStateMachine:
    type: StateMachine
    outcomes: [succeeded, aborted]
    initial_state: Initialize
    states:
      Initialize:
        type: CallbackState
        transitions:
          succeeded: ProcessData
```

## Architecture

### Single Server Model

One server instance serves all projects and sessions:

- Runs on port 3737 (configurable)
- Manages session registry at `~/.mermaid-collab/sessions.json`
- Creates per-session storage directories on demand
- Broadcasts WebSocket updates with project/session context

### Services

- **SessionRegistry**: Tracks sessions across projects
- **DiagramManager**: Per-session diagram CRUD
- **DocumentManager**: Per-session document CRUD
- **MetadataManager**: Per-session folder and lock state
- **Validator**: Mermaid syntax validation
- **Renderer**: Server-side SVG generation
- **WebSocketHandler**: Real-time updates with session filtering

## Development

```bash
# Run server directly (for development)
bun run src/server.ts

# Run MCP server directly
bun run src/mcp/server.ts
```

## License

MIT
