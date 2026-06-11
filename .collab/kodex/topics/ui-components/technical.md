## Layout Components

**Header.tsx** - Top navigation:
- Theme toggle, session selector, chat/terminal toggles
- Edit mode toggle, connection status badge
- Create/refresh session buttons

**Sidebar.tsx** - Left sidebar:
- Search input for filtering
- Item cards for diagrams/documents
- Kodex section link

**SplitPane.tsx** - Resizable split layout

## Editor Components

**UnifiedEditor.tsx** - Main editor combining:
- CodeMirror for syntax-highlighted editing
- MermaidPreview / MarkdownPreview for live rendering
- Undo/redo history, export (SVG/PNG)
- Proposal/comment system for collaboration

**CodeMirrorWrapper.tsx** - CodeMirror integration with:
- Mermaid and Markdown syntax highlighting
- Controlled component pattern
- Debounced updates

## AI-UI Component System

33 components across 5 categories in `components/ai-ui/`:

**Display (9)**: Table, CodeBlock, DiffView, JsonViewer, Markdown, Image, Spinner, Badge, SkillTransition

**Layout (6)**: Card, Section, Columns, Accordion, Alert, Divider

**Interactive (6)**: Wizard, Checklist, ApprovalButtons, ProgressBar, Tabs, Link

**Inputs (11)**: MultipleChoice, TextInput, TextArea, Checkbox, Confirmation, Dropdown, RadioGroup, Toggle, NumberInput, Slider, FileUpload

**Mermaid (2)**: DiagramEmbed, WireframeEmbed

**Registry Pattern** (`registry.ts`):
```typescript
const component = ComponentRegistry.get('Table');
const allDisplayComponents = ComponentRegistry.byCategory('display');
```

## Question Panel

**QuestionPanel.tsx** - Slide-in overlay for Claude questions:
- Keyboard navigation (Escape to dismiss)
- Focus trap for accessibility
- Dynamic component rendering via QuestionRenderer
- Question history tracking

## Terminal Components

**TerminalTabBar.tsx** - Manages multiple terminal tabs
**TerminalTabsContainer.tsx** - Container for xterm.js instances

## Hooks

- `useTheme` - Dark/light mode
- `useSession` - Current session context
- `useDataLoader` - Data fetching with loading states
- `useEditorHistory` - Undo/redo stack
- `useExportDiagram` - SVG/PNG export