# Skeleton: Item 3 - Update MCP render_ui documentation

## APPROVED

## Task Dependency Graph

```yaml
tasks:
  - id: mcp-docs-update
    files: [src/mcp/tools/render-ui.ts]
    description: Update tool description with component reference
    depends-on: [registry-update]
```

## File Modification

```typescript
// FILE: src/mcp/tools/render-ui.ts (MODIFY)

// TODO: Add COMPONENT_REFERENCE constant
const COMPONENT_REFERENCE = `
## Available Components (32)

### Display
- Table: { columns, rows }
...
`;

// TODO: Append COMPONENT_REFERENCE to tool description
```

## Verification

After implementation:
- MCP tool description includes all 32 components
- Components grouped by category
