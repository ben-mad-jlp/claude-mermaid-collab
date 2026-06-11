## Implementation Details

### Session Directory Structure
```
.collab/
├── sessions/
│   └── <session-name>/
│       ├── metadata.json        # Session metadata
│       ├── collab-state.json    # Current phase, items, etc.
│       ├── diagrams/            # Mermaid diagrams
│       ├── documents/           # Markdown documents
│       └── terminal-sessions.json
└── kodex/                       # Knowledge base
```

### ColLabState Interface
```typescript
interface CollabState {
  phase: CollabPhase;
  template: CollabTemplate;
  lastActivity: string;
  pendingVerificationIssues: VerificationIssue[];
}
```

### Key Functions
- `createCollabSession(baseDir, template, customName?)`: Create new session
- `getCollabSessionState(baseDir, sessionName)`: Read state
- `updateCollabSessionState(baseDir, sessionName, updates)`: Update state
- `listCollabSessions(baseDir)`: List all sessions