# UI

The React frontend provides a collaborative interface for working with Mermaid diagrams, markdown documents, and Claude interactions.

## Architecture

- **Framework**: React with TypeScript
- **State Management**: Zustand stores (uiStore, sessionStore, questionStore, chatStore)
- **Styling**: Tailwind CSS with dark mode support
- **Build**: Vite for fast development and production builds

## Key Features

- **Unified Editor**: Single editor component handling both diagrams and documents
- **Live Preview**: Real-time Mermaid diagram rendering
- **Split Pane Layout**: Resizable panels for editor/preview and chat
- **Mobile Support**: Responsive design with dedicated mobile layout
- **WebSocket Integration**: Real-time updates and Claude interactions
- **Auto-Save**: 2-second debounced saves