## Source Files

### Core Managers
- `src/services/diagram-manager.ts` - Mermaid diagram CRUD
- `src/services/document-manager.ts` - Markdown document CRUD
- `src/services/session-registry.ts` - Cross-project session tracking
- `src/services/collab-manager.ts` - Collab session state and phases
- `src/services/ui-manager.ts` - Blocking UI render management
- `src/services/terminal-manager.ts` - Terminal session persistence
- `src/services/kodex-manager.ts` - Knowledge base with SQLite

### Support Services
- `src/services/renderer.ts` - Mermaid diagram rendering
- `src/services/validator.ts` - Mermaid syntax validation
- `src/services/smach-transpiler.ts` - SMACH to Mermaid transpilation
- `src/services/file-watcher.ts` - File change detection
- `src/services/metadata-manager.ts` - Diagram metadata handling
- `src/services/question-manager.ts` - Question/answer management
- `src/services/status-manager.ts` - Status tracking
- `src/services/dom-setup.ts` - DOM setup for server-side rendering

### Tests
- `src/services/__tests__/session-registry.test.ts`
- `src/services/__tests__/ui-manager.test.ts`
- `src/services/__tests__/kodex-manager.test.ts`
- `src/services/__tests__/terminal-manager.test.ts`
- `src/services/__tests__/status-manager.test.ts`