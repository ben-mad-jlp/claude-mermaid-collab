# Render UI

The render_ui MCP tool pushes JSON UI definitions to the browser for interactive user input. Supports 32 component types across display, layout, interactive, and input categories.

## Key Features

- **Blocking Mode**: Waits indefinitely for user response (default: true)
- **Non-Blocking Mode**: Returns immediately after rendering
- **WebSocket Broadcast**: UI sent to all connected browser clients
- **Form Data Collection**: Input components collect data on action
- **Action Tracking**: Each UI gets unique ID for response matching

## Component Categories

1. **Display** (8): Table, CodeBlock, DiffView, JsonViewer, Markdown, Image, Spinner, Badge
2. **Layout** (6): Card, Section, Columns, Accordion, Alert, Divider
3. **Interactive** (6): Wizard, Checklist, ApprovalButtons, ProgressBar, Tabs, Link
4. **Inputs** (10): MultipleChoice, TextInput, TextArea, Checkbox, Confirmation, RadioGroup, Toggle, NumberInput, Slider, FileUpload
5. **Mermaid** (2): DiagramEmbed, WireframeEmbed