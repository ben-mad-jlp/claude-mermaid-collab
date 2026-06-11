# Backend Services

The services layer provides core business logic for the mermaid-collab plugin. Each service manages a specific domain: diagrams, documents, sessions, UI state, terminals, and knowledge base.

## Service Architecture

Services are singleton classes instantiated per-project or globally. They handle:
- File system operations for diagrams and documents
- Session and collab state persistence
- UI rendering and blocking response management
- Terminal session lifecycle
- Kodex knowledge base with SQLite + Markdown storage

## Key Patterns

- **Manager Pattern**: Each domain has a dedicated manager class
- **In-Memory Index**: DiagramManager and DocumentManager maintain indexes for fast lookups
- **Async File I/O**: All file operations use async/await
- **SQLite for Analytics**: KodexManager uses SQLite for metadata, flags, and access logs