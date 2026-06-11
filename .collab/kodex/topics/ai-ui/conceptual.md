# AI UI Components

The AI-UI system provides 33 React components that Claude can render in the browser via the `render_ui` MCP tool. Components are dynamically rendered based on JSON definitions.

## Component Categories

1. **Display (9)** - Table, CodeBlock, DiffView, JsonViewer, Markdown, Image, Spinner, Badge, SkillTransition
2. **Layout (6)** - Card, Section, Columns, Accordion, Alert, Divider
3. **Interactive (6)** - Wizard, Checklist, ApprovalButtons, ProgressBar, Tabs, Link
4. **Inputs (11)** - MultipleChoice, TextInput, TextArea, Checkbox, Confirmation, Dropdown, RadioGroup, Toggle, NumberInput, Slider, FileUpload
5. **Mermaid (2)** - DiagramEmbed, WireframeEmbed

## How It Works

1. Claude calls `render_ui` with JSON component definition
2. Server broadcasts to browser via WebSocket
3. Registry looks up component by type
4. Component renders with provided props
5. User interaction triggers response back to Claude