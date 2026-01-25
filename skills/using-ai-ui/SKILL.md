# Using AI-UI Components

Guide for using the `render_ui` MCP tool to display interactive UI components in the browser.

## Overview

The `render_ui` tool broadcasts JSON UI definitions to connected browser clients and optionally waits for user interaction. Use this for:
- Asking questions with structured options
- Collecting form data
- Displaying progress or status
- Showing data in rich formats

## Blocking vs Non-Blocking Mode

**Blocking mode (default):** Tool waits for user action before returning.
```json
{ "blocking": true, "timeout": 30000 }
```
Response includes `action` and `data` from user interaction.

**Non-blocking mode:** Tool returns immediately after rendering.
```json
{ "blocking": false }
```
Use for status displays that don't need user input.

## Form Data Collection

Input components with a `name` prop automatically collect form data. When user clicks an action button, all named inputs are collected and returned in `data`.

```json
{
  "type": "Card",
  "props": { "title": "Settings" },
  "children": [
    { "type": "TextInput", "props": { "name": "username", "label": "Username" } },
    { "type": "Toggle", "props": { "name": "notifications", "label": "Enable notifications" } }
  ],
  "actions": [{ "id": "save", "label": "Save", "primary": true }]
}
```

Response: `{ "action": "save", "data": { "username": "alice", "notifications": true } }`

---

## Component Selection Guide

### Need user to choose from options?

| Scenario | Component | Notes |
|----------|-----------|-------|
| 2-5 visible options | RadioGroup | Shows all options |
| 6+ options | MultipleChoice | Dropdown/select |
| Boolean yes/no | Toggle | Switch control |
| Multiple selections | Checkbox | Checkboxes |

### Need text input?

| Scenario | Component | Notes |
|----------|-----------|-------|
| Single line | TextInput | type: text/email/url |
| Multi-line | TextArea | rows: number |
| Number with bounds | NumberInput | min/max/step |
| Number in range | Slider | showValue for display |
| File selection | FileUpload | accept, multiple |

### Displaying data?

| Scenario | Component | Notes |
|----------|-----------|-------|
| Code | CodeBlock | language, showLineNumbers |
| JSON | JsonViewer | collapsed option |
| Table data | Table | columns, rows |
| Rich text | Markdown | content |
| Image | Image | src, alt, caption |

### Showing status?

| Scenario | Component | Notes |
|----------|-----------|-------|
| Loading | Spinner | size, label |
| Label/tag | Badge | variant, size |
| Progress | ProgressBar | value, max, label |

---

## Component Reference

### Display Components (8)

#### Table
```json
{
  "type": "Table",
  "props": {
    "columns": [
      { "key": "name", "header": "Name" },
      { "key": "status", "header": "Status" }
    ],
    "rows": [
      { "name": "Task 1", "status": "Complete" },
      { "name": "Task 2", "status": "Pending" }
    ]
  }
}
```

#### CodeBlock
```json
{
  "type": "CodeBlock",
  "props": {
    "code": "const x = 1;",
    "language": "javascript",
    "showLineNumbers": true
  }
}
```

#### Image
```json
{
  "type": "Image",
  "props": {
    "src": "https://example.com/image.png",
    "alt": "Description",
    "caption": "Figure 1: Example",
    "objectFit": "contain"
  }
}
```

#### Spinner
```json
{
  "type": "Spinner",
  "props": { "size": "md", "label": "Loading..." }
}
```

#### Badge
```json
{
  "type": "Badge",
  "props": { "text": "New", "variant": "success", "size": "sm" }
}
```
Variants: default, info, success, warning, error

### Layout Components (6)

#### Card
```json
{
  "type": "Card",
  "props": { "title": "Title", "subtitle": "Subtitle" },
  "children": [...],
  "actions": [{ "id": "submit", "label": "Submit", "primary": true }]
}
```

#### Divider
```json
{
  "type": "Divider",
  "props": { "orientation": "horizontal", "label": "OR" }
}
```

### Interactive Components (6)

#### Link
```json
{
  "type": "Link",
  "props": {
    "label": "View docs",
    "href": "https://example.com",
    "external": true,
    "variant": "primary"
  }
}
```
Variants: default, primary, subtle

### Input Components (10)

#### RadioGroup
```json
{
  "type": "RadioGroup",
  "props": {
    "name": "choice",
    "label": "Select one",
    "options": [
      { "value": "a", "label": "Option A" },
      { "value": "b", "label": "Option B" }
    ],
    "orientation": "vertical"
  }
}
```

#### Toggle
```json
{
  "type": "Toggle",
  "props": {
    "name": "enabled",
    "label": "Enable feature",
    "size": "md"
  }
}
```
Sizes: sm, md, lg

#### NumberInput
```json
{
  "type": "NumberInput",
  "props": {
    "name": "quantity",
    "label": "Quantity",
    "min": 1,
    "max": 100,
    "step": 1
  }
}
```

#### Slider
```json
{
  "type": "Slider",
  "props": {
    "name": "volume",
    "label": "Volume",
    "min": 0,
    "max": 100,
    "showValue": true
  }
}
```

#### FileUpload
```json
{
  "type": "FileUpload",
  "props": {
    "name": "files",
    "label": "Upload files",
    "accept": ".pdf,.doc",
    "multiple": true,
    "maxSize": 5242880
  }
}
```

---

## Best Practices

1. **Keep UIs focused** - One primary action per UI
2. **Use blocking mode** for decisions that affect workflow
3. **Provide clear labels** - Every input needs context
4. **Handle disabled states** - Set `disabled: true` when UI shouldn't be interactive
5. **Use appropriate components** - Match component to data type

## Common Patterns

### Yes/No Confirmation
```json
{
  "type": "Card",
  "props": { "title": "Confirm" },
  "children": [
    { "type": "Markdown", "props": { "content": "Proceed with this action?" } }
  ],
  "actions": [
    { "id": "yes", "label": "Yes", "primary": true },
    { "id": "no", "label": "No" }
  ]
}
```

### Multiple Choice Selection
```json
{
  "type": "Card",
  "props": { "title": "Choose approach" },
  "children": [
    {
      "type": "RadioGroup",
      "props": {
        "name": "approach",
        "options": [
          { "value": "1", "label": "Option 1 (Recommended)" },
          { "value": "2", "label": "Option 2" },
          { "value": "3", "label": "Option 3" }
        ]
      }
    }
  ],
  "actions": [{ "id": "select", "label": "Continue", "primary": true }]
}
```

### Form with Multiple Inputs
```json
{
  "type": "Card",
  "props": { "title": "Configuration" },
  "children": [
    { "type": "TextInput", "props": { "name": "name", "label": "Name" } },
    { "type": "NumberInput", "props": { "name": "count", "label": "Count", "min": 1 } },
    { "type": "Toggle", "props": { "name": "debug", "label": "Debug mode" } }
  ],
  "actions": [
    { "id": "cancel", "label": "Cancel" },
    { "id": "save", "label": "Save", "primary": true }
  ]
}
```

### Progress Display (Non-blocking)
```json
{
  "type": "Card",
  "props": { "title": "Processing" },
  "children": [
    { "type": "ProgressBar", "props": { "value": 45, "max": 100, "label": "45% complete" } },
    { "type": "Spinner", "props": { "label": "Please wait..." } }
  ]
}
```

## Integration

**MCP Tool:** `mcp__plugin_mermaid-collab_mermaid__render_ui`

**Parameters:**
- `project` (required): Absolute path to project root
- `session` (required): Session name
- `ui` (required): JSON UI component definition
- `blocking` (optional): Wait for user action (default: true)
- `timeout` (optional): Timeout in ms (default: 30000)

**Returns:**
- `action`: The action ID clicked
- `data`: Collected form data from named inputs
