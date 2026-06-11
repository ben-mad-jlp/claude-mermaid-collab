# Project Structure

Monorepo containing backend server, React frontend, Claude Code skills, and plugins.

## Top-Level Structure

```
/
├── src/           # Backend server & MCP
├── ui/            # React frontend
├── skills/        # Claude Code skills (38+)
├── plugins/       # Plugin ecosystem
│   └── wireframe/ # Wireframe diagram plugin
├── .claude-plugin/# Plugin configuration
├── codex/         # Kodex knowledge base
└── docs/          # Documentation
```

## Technology Stack

- **Runtime**: Bun
- **Backend**: TypeScript HTTP server with MCP integration
- **Frontend**: React 18 + Vite + Tailwind CSS
- **State**: Zustand
- **Testing**: Vitest + React Testing Library