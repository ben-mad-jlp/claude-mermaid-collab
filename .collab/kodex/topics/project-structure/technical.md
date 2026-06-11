## Backend Structure (`/src/`)

```
src/
├── server.ts          # Main HTTP server (Bun.serve)
├── config.ts          # Environment configuration
├── types.ts           # Shared types
├── mcp/               # MCP server integration
│   ├── setup.ts       # Tool definitions (47 tools)
│   ├── tools/         # Tool implementations
│   └── workflow/      # Skill state machine
├── routes/            # REST API handlers
│   ├── api.ts         # Main API routes
│   ├── kodex-api.ts   # Knowledge base API
│   └── websocket.ts   # WebSocket routes
├── services/          # Business logic
│   ├── diagram-manager.ts
│   ├── document-manager.ts
│   ├── kodex-manager.ts
│   └── session-registry.ts
├── terminal/          # PTY terminal system
└── websocket/         # Real-time collaboration
```

## Frontend Structure (`/ui/src/`)

```
ui/src/
├── App.tsx            # Main application
├── components/
│   ├── ai-ui/         # AI-powered components
│   ├── diagram/       # Diagram editor
│   ├── kodex/         # Knowledge base UI
│   └── terminal/      # Terminal component
├── hooks/             # React hooks
├── stores/            # Zustand stores
├── services/          # API clients
└── types/             # Type definitions
```

## Skills Structure (`/skills/`)

38+ skills organized by workflow:
- `collab/` - Session management
- `brainstorming-*/` - Design phases
- `rough-draft-*/` - Implementation phases
- `executing-plans*/` - Task execution
- `kodex-*/` - Knowledge base management

## Key Scripts

```bash
npm run dev        # Start API + UI
npm run test:ci    # Run all tests
npm version patch  # Version bump
```