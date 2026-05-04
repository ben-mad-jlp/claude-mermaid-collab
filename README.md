# Mermaid Collab

A Claude Code plugin that provides a real-time collaboration UI, 150+ MCP tools, and structured workflows for designing and building software with Claude.

<img src="ui/public/logo.png" alt="Mermaid Collab" width="200" />

## What is Mermaid Collab?

Mermaid Collab gives Claude Code a persistent collaboration layer — a browser UI where diagrams, documents, designs, code snippets, and spreadsheets appear in real time as Claude works. It also includes a full browser automation suite (Chrome via CDP) and a pseudocode documentation system.

**Key capabilities:**
- **Collab UI** — React interface with live preview of all artifacts
- **Visual Design Editor** — Figma-like canvas with layers, properties, and component system
- **Browser Automation** — Drive real Chrome on Windows via CDP tunnel (27 tools)
- **Pseudocode System** — File-level documentation with call graphs and coverage
- **30 Skills** — Orchestrated workflow patterns for vibe sessions, planning, debugging, and review
- **VSCode Extension** — Status bar integration with one-click Chrome CDP toggle

---

## Quick Start

### 1. Install the Plugin

```
/plugin install ben-mad-jlp/claude-mermaid-collab
```

### 2. Start the Server

```bash
bun run bin/mermaid-collab.ts start
```

The API server runs on `http://localhost:9002` and the UI at `http://localhost:9102`.

### 3. Start a Session

```
/collab
```

---

## Server Ports

| Service | Port | Description |
|---------|------|-------------|
| API + WebSocket + MCP | 9002 | REST API, WebSocket, MCP HTTP transport |
| UI | 9102 | React frontend (dev mode via Vite) |
| CDP | 9333 | Chrome DevTools Protocol (Windows Chrome via SSH tunnel) |

---

## Collab UI

Access at `http://localhost:9102` after starting the server.

- Split-pane editors with live preview for diagrams, documents, snippets, and spreadsheets
- Visual design editor with layers panel, properties panel, and component library
- Terminal integration (tmux sessions)
- Session browser with project grouping
- Real-time WebSocket updates across all open tabs

---

## Visual Design Editor

A canvas-based design tool for creating UI mockups and design systems.

**Features:**
- Freeform canvas with zoom and pan (middle-drag, Alt+drag, Shift+scroll)
- Layers panel for node hierarchy
- Properties panel for size, position, color, text, and style
- Component system with instances and detach
- Design tokens
- Page-based layouts
- Export to SVG and PNG
- Version history with revert

**Tools available:** 40+ MCP tools for programmatic design creation and editing.

---

## Browser Automation (CDP)

Claude can drive a real Chrome browser on your Windows machine via SSH tunnel. The VSCode extension manages Chrome launch and tunnel setup with one button.

**Setup:**
1. Install the VSCode extension (`mermaid-collab-vscode`)
2. Click the CDP button in the status bar — Chrome launches with remote debugging on port 9333, tunneled to the Linux dev server

**27 browser tools:**

| Category | Tools |
|----------|-------|
| **Navigation** | `browser_open`, `browser_navigate`, `browser_list_pages`, `browser_select_page`, `browser_close` |
| **Interaction** | `browser_click`, `browser_fill`, `browser_fill_form`, `browser_type_text`, `browser_drag`, `browser_hover`, `browser_press_key`, `browser_select`, `browser_upload_file`, `browser_handle_dialog` |
| **Inspection** | `browser_screenshot`, `browser_take_snapshot`, `browser_evaluate`, `browser_get_url`, `browser_wait_for` |
| **Diagnostics** | `browser_console`, `browser_network`, `browser_take_memory_snapshot`, `browser_emulate`, `browser_resize_page`, `browser_lighthouse_audit`, `browser_performance_analyze_insight` |

---

## Pseudocode System

A file-level documentation layer stored in a SQLite database (`.collab/pseudo/`). Claude scans source files, writes prose descriptions of functions and modules, and maintains call graphs and coverage metrics.

**Key tools:** `pseudo_hot_files`, `pseudo_search`, `pseudo_find_function_v6`, `pseudo_call_chain_v6`, `pseudo_coverage_report`, `pseudo_upsert_prose_v6`, `pseudo_import_graph`, `pseudo_impact_analysis`

---

## MCP Tools Reference

All tools are available to Claude Code via HTTP MCP at `http://localhost:9002/mcp`.

### Session & Project
`check_server_health`, `list_sessions`, `list_projects`, `register_project`, `unregister_project`, `generate_session_name`, `register_claude_session`, `archive_session`, `clear_session_artifacts`, `generate_session_summary`, `validate_session_links`

### Diagrams
`create_diagram`, `update_diagram`, `patch_diagram`, `get_diagram`, `list_diagrams`, `delete_diagram` (via deprecate), `validate_diagram`, `preview_diagram`, `export_diagram_svg`, `export_diagram_png`, `transpile_diagram`, `diagram_from_code`, `get_diagram_history`, `revert_diagram`

### Documents
`create_document`, `update_document`, `patch_document`, `get_document`, `list_documents`, `delete_document`, `preview_document`, `get_document_history`, `revert_document`

### Designs (40+ tools)
`create_design`, `update_design`, `get_design`, `list_designs`, `delete_design`, `add_design_node`, `update_design_node`, `get_design_node`, `remove_design_node`, `list_design_nodes`, `batch_design_operations`, `group_design_nodes`, `ungroup_design_nodes`, `duplicate_design_nodes`, `align_design_nodes`, `transform_design_nodes`, `reorder_design_nodes`, `create_design_from_tree`, `add_design_image`, `set_node_image`, `export_design_svg`, `export_design_png`, `export_design_code`, `describe_design`, `describe_design_changes`, `lint_design`, `annotate_node`, `get_annotations`, `remove_annotation`, `create_component`, `create_instance`, `detach_instance`, `list_components`, `save_component`, `load_component`, `list_library_components`, `create_design_tokens`, `apply_design_tokens`, `create_from_template`, `design_to_diagram`, `get_design_history`, `revert_design`, `get_design_item`, `patch_design_item`

### Snippets
`create_snippet`, `update_snippet`, `patch_snippet`, `get_snippet`, `list_snippets`, `delete_snippet`, `export_snippet`, `snippet_history`, `revert_snippet`

### Spreadsheets
`create_spreadsheet`, `update_spreadsheet`, `patch_spreadsheet`, `get_spreadsheet`, `list_spreadsheets`, `delete_spreadsheet`, `export_spreadsheet_csv`, `get_spreadsheet_history`, `revert_spreadsheet`

### Images & Embeds
`create_image`, `get_image`, `list_images`, `delete_image`, `create_embed`, `list_embeds`, `delete_embed`, `create_storybook_embed`, `list_storybook_stories`

### Terminal
`terminal_create_session`, `terminal_list_sessions`, `terminal_kill_session`, `terminal_rename_session`, `terminal_reorder_sessions`

### Tasks & Workflow
`get_task_graph`, `sync_task_graph`, `update_task_status`, `update_tasks_status`

### Session Todos
`add_session_todo`, `list_session_todos`, `update_session_todo`, `toggle_session_todo`, `remove_session_todo`, `clear_completed_session_todos`, `reorder_session_todos`

### AI UI
`render_ui`, `update_ui`, `get_ui_response`, `request_user_input`, `dismiss_ui`

### Utilities
`get_install_path`, `consult_grok`, `deprecate_artifact`, `set_artifact_metadata`, `add_lesson`, `list_lessons`, `generate_session_name`

---

## Skills (30)

Skills are markdown instruction files loaded on-demand by Claude Code.

| Skill | Purpose |
|-------|---------|
| `collab` | Entry point — session management |
| `vibe-active` | Freeform collab session |
| `vibe-checkpoint` | Save vibe state before `/clear` |
| `vibe-read` | Read current vibe instructions |
| `vibe-agents` | Toggle agent dispatch mode |
| `vibe-go` | Launch agents in dependency waves |
| `vibe-review` | Bug and completeness review |
| `vibe-blueprint` | Generate task graph from artifacts |
| `collab-todo` | Pick a session to work on |
| `writing-plans` | Create implementation plan |
| `writing-skills` | Create or edit skills |
| `executing-plans-review` | Verify implementation against design |
| `executing-plans-bugreview` | Bug review before completion |
| `test-driven-development` | RED-GREEN-REFACTOR workflow |
| `requesting-code-review` | Submit work for review |
| `receiving-code-review` | Handle incoming review feedback |
| `systematic-debugging` | Root cause analysis |
| `pair-mode` | Toggle pair programming mode |
| `pair` | Before/after diagram approval workflow |
| `dispatching-parallel-agents` | Parallel independent task agents |
| `pseudocode` | Create/update pseudocode for a file |
| `pseudocode-seed` | Seed pseudocode across hot files |
| `wireframing` | Create designs with MCP tools |
| `mermaid-collab` | Create diagrams and designs |
| `consult-grok` | Second opinion from Grok (xAI) |
| `ui-question` | Ask user a question via browser UI |
| `using-superpowers` | Establish skill/tool usage patterns |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Collaboration Server                 │
│                     port 9002                        │
├──────────────┬──────────────┬────────────────────────┤
│  REST API    │  WebSocket   │  MCP HTTP Transport    │
├──────────────┴──────────────┴────────────────────────┤
│  DiagramManager │ DocumentManager │ DesignManager    │
│  SnippetManager │ PseudoDB        │ TerminalManager  │
└─────────────────────────────────────────────────────┘
         ↓                    ↓
  React UI (9102)      Claude Code (MCP)
                              ↓
                    chrome-devtools-mcp
                    (CDP → port 9333)
                              ↓
                  Chrome on Windows (via SSH tunnel)
```

**Session storage:**
```
/your/project/
└── .collab/
    ├── sessions/
    │   └── <session-name>/
    │       ├── documents/
    │       ├── diagrams/
    │       ├── designs/
    │       ├── snippets/
    │       ├── spreadsheets/
    │       ├── images/
    │       └── embeds/
    └── pseudo/          # Pseudocode SQLite DB
```

---

## VSCode Extension

The `mermaid-collab-vscode` extension adds:
- Status bar showing collab server connection state
- CDP toggle button — launches Chrome with `--remote-debugging-port=9333` and creates an SSH reverse tunnel so the Linux dev server can reach Windows Chrome

Install the `.vsix` from `extensions/vscode/`.

---

## Development

```bash
# Start everything (recommended)
/srv/codebase/dev-tools/dev-start.sh

# Or manually
bun run dev          # API server + Vite UI in parallel
bun run dev:api      # API only (port 9002)
bun run dev:ui       # Vite only (port 9102)

# Server daemon
bun run server:start
bun run server:stop
bun run server:status

# Tests
npm run test:ci           # All UI tests
npm run test:ci -- path   # Specific test file
npm run test:backend      # Backend tests
```

**Versioning** — always use `npm version patch|minor|major` (never edit version numbers manually). The version hook syncs `package.json`, `plugin.json`, `marketplace.json`, and `server.ts` automatically.

---

## License

MIT
