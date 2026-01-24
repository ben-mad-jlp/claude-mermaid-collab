# Pseudocode: Item 3 - Update MCP render_ui documentation

## APPROVED

## Documentation Update Process

```
FILE: src/mcp/tools/render-ui.ts

1. LOCATE the tool definition object

2. UPDATE the description field to include component reference:
   - Add header: "## Available Components (32)"
   - Group by category: Display, Layout, Interactive, Inputs, Mermaid
   - For each component, show: Name and key props
   
3. FORMAT for MCP tool description:
   - Keep concise (tool descriptions have size limits)
   - Use consistent format: ComponentName: { prop1, prop2?, prop3? }
   - Mark optional props with ?
   - Group related components together

4. INCLUDE all 32 components:
   Display (8): Table, CodeBlock, DiffView, JsonViewer, Markdown, Image, Spinner, Badge
   Layout (6): Card, Section, Columns, Accordion, Alert, Divider
   Interactive (6): Wizard, Checklist, ApprovalButtons, ProgressBar, Tabs, Link
   Inputs (10): MultipleChoice, TextInput, TextArea, Checkbox, Confirmation,
               RadioGroup, Toggle, NumberInput, Slider, FileUpload
   Mermaid (2): DiagramEmbed, WireframeEmbed
```

## Tool Description Template

```
CONST COMPONENT_REFERENCE = `
## Available Components (32)

### Display
- Table: { columns, rows }
- CodeBlock: { code, language }
...

### Inputs (form data collected on submit)
- RadioGroup: { options, name, label? }
- Toggle: { name, label? }
...
`
```
