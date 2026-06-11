# React UI Components

The React UI provides the browser interface for mermaid-collab, including diagram/document editing, session management, terminal integration, chat, and the Kodex knowledge base.

## Architecture

The UI uses:
- **React 18** with functional components and hooks
- **Zustand** for state management (uiStore, sessionStore, proposalStore, questionStore)
- **Tailwind CSS** with dark mode support
- **TypeScript** throughout

## Component Categories

1. **Layout** - Header, Sidebar, SplitPane, WorkspacePanel
2. **Editors** - UnifiedEditor, CodeMirrorWrapper, MermaidPreview, MarkdownPreview
3. **AI-UI** - 33 dynamic components for Claude interactions
4. **Dashboard** - Session cards, item grids
5. **Terminal** - Tab bar, terminal containers
6. **Chat** - Drawer, message area, input controls
7. **Question Panel** - Overlay for Claude questions
8. **Kodex** - Knowledge base sidebar