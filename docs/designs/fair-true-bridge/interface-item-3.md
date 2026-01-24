# Interface Definition: Item 3 - Update MCP render_ui documentation

## APPROVED

## File Structure

- `src/mcp/tools/render-ui.ts` (modify existing)

---

## Changes Required

Update the tool description to include component reference:

```typescript
// Add to tool description
const COMPONENT_REFERENCE = `
## Available Components (32)

### Display
- Table: { columns: [{key, header}], rows: [{key: value}] }
- CodeBlock: { code, language, showLineNumbers }
- DiffView: { oldCode, newCode, language }
- JsonViewer: { data, collapsed }
- Markdown: { content }
- Image: { src, alt, width?, height?, caption? }
- Spinner: { size?, label? }
- Badge: { text, variant?, size? }

### Layout
- Card: { title?, subtitle?, footer?, elevation? }
- Section: { title, collapsible? }
- Columns: { columns: number }
- Accordion: { items: [{title, content}] }
- Alert: { type, title?, message }
- Divider: { orientation?, label? }

### Interactive
- Wizard: { steps: [{title, content}], currentStep }
- Checklist: { items: [{label, checked}] }
- ApprovalButtons: { actions: [{id, label, primary?}] }
- ProgressBar: { value, max?, label? }
- Tabs: { tabs: [{id, label, content}] }
- Link: { href?, label, onClick?, variant? }

### Inputs (form data collected on action)
- MultipleChoice: { options: [{value, label}], name, label? }
- TextInput: { name, label?, placeholder? }
- TextArea: { name, label?, placeholder?, rows? }
- Checkbox: { options: [{value, label}], name, label? }
- Confirmation: { message, confirmLabel?, cancelLabel? }
- RadioGroup: { options: [{value, label}], name, label? }
- Toggle: { name, label?, checked? }
- NumberInput: { name, label?, min?, max?, step? }
- Slider: { name, label?, min?, max?, step? }
- FileUpload: { name, accept?, multiple? }

### Mermaid
- DiagramEmbed: { diagramId }
- WireframeEmbed: { wireframeId }
`;
```

---

## Component Interactions

- MCP tool description visible to Claude when using render_ui
- Enables informed component selection
