## Component Registry

```typescript
interface ComponentMetadata {
  name: string;
  category: 'display' | 'layout' | 'interactive' | 'inputs' | 'mermaid';
  description: string;
  component: React.ComponentType<any>;
}

const componentRegistry: Map<string, ComponentMetadata>;

// Usage
const Component = ComponentRegistry.get('Table');
const displayComponents = ComponentRegistry.byCategory('display');
```

## JSON Schema Examples

**Table:**
```json
{
  "type": "Table",
  "columns": [{"key": "name", "header": "Name"}],
  "rows": [{"name": "Alice"}]
}
```

**ApprovalButtons:**
```json
{
  "type": "ApprovalButtons",
  "actions": [
    {"id": "approve", "label": "Approve", "primary": true},
    {"id": "reject", "label": "Reject"}
  ]
}
```

**MultipleChoice:**
```json
{
  "type": "MultipleChoice",
  "name": "option",
  "label": "Select one",
  "options": [
    {"value": "a", "label": "Option A"},
    {"value": "b", "label": "Option B"}
  ]
}
```

**Card with children:**
```json
{
  "type": "Card",
  "title": "Details",
  "children": [
    {"type": "Markdown", "content": "## Hello"},
    {"type": "Button", "label": "Click"}
  ]
}
```

## Input Handling

Input components collect form data sent on action:
- `name` prop identifies the field
- Value included in response `data` object
- Supports single and multi-select

## Blocking Mode

When `blocking: true`, `render_ui` waits for user response:
```typescript
const response = await renderUI({
  ui: { type: 'Confirmation', message: 'Proceed?' },
  blocking: true,
  timeout: 30000
});
// response.action = 'confirm' | 'cancel'
```