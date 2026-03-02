# Using the Design Editor

The design editor is a Figma-compatible vector design tool built on CanvasKit (Skia WASM). It supports rectangles, ellipses, text, frames with auto-layout, lines, groups, sections, and components.

## MCP Tools

### Creating Designs

```
create_design(project, session, name, content)
```

Content is a serialized scene graph: `{ rootId, nodes[] }`. Each node has position, size, fills, strokes, text properties, auto-layout, etc.

### High-Level Node Tools

Use these instead of manually constructing scene graph JSON:

```
# Add a rectangle
add_design_node(project, session, designId, type="RECTANGLE", x=100, y=100, width=200, height=100, fill="#3B82F6", cornerRadius=8)

# Add text
add_design_node(project, session, designId, type="TEXT", x=100, y=50, text="Hello World", fontSize=24, fontWeight=700, fill="#111827")

# Add a frame with auto-layout
add_design_node(project, session, designId, type="FRAME", name="Card", x=50, y=50, width=300, height=400, fill="#FFFFFF", layoutMode="VERTICAL", itemSpacing=12, padding=16, cornerRadius=12)

# Update a node
update_design_node(project, session, designId, nodeId="abc123", properties={ x: 200, fill: "#EF4444" })

# Remove a node
remove_design_node(project, session, designId, nodeId="abc123")
```

### Batch Operations

For complex designs, use batch operations to create multiple nodes in one call. Use temp IDs to reference nodes created earlier in the batch:

```
batch_design_operations(project, session, designId, operations=[
  { op: "add", type: "FRAME", nodeId: "card1", properties: { name: "Card", x: 50, y: 50, width: 300, height: 200, fill: "#FFFFFF", layoutMode: "VERTICAL", itemSpacing: 8, padding: 16, cornerRadius: 12 } },
  { op: "add", type: "TEXT", parentId: "card1", properties: { text: "Card Title", fontSize: 18, fontWeight: 700 } },
  { op: "add", type: "TEXT", parentId: "card1", properties: { text: "Card description goes here", fontSize: 14, fill: "#6B7280" } },
  { op: "add", type: "RECTANGLE", parentId: "card1", properties: { name: "Button", width: 268, height: 40, fill: "#3B82F6", cornerRadius: 8 } },
])
```

### Other Tools

```
get_design(project, session, id)        # Read design content
list_designs(project, session)           # List all designs
update_design(project, session, id, content)  # Full content update
delete_design(project, session, id)      # Delete design
get_design_history(project, session, id) # Version history
revert_design(project, session, id, timestamp) # Revert to version
```

## Scene Graph Structure

The serialized format is `{ rootId: string, nodes: SceneNode[] }`.

### Node Types
- `FRAME` - Container with optional auto-layout and background
- `RECTANGLE` - Basic rectangle shape
- `ELLIPSE` - Ellipse/circle shape
- `TEXT` - Text with font properties
- `LINE` - Line segment
- `GROUP` - Group container (transparent)
- `SECTION` - Section container (like Figma sections)
- `COMPONENT` / `INSTANCE` - Component system

### Key Node Properties

**Geometry:** `x`, `y`, `width`, `height`, `rotation`

**Appearance:** `fills[]`, `strokes[]`, `opacity`, `cornerRadius`, `visible`

**Text:** `text`, `fontSize`, `fontFamily`, `fontWeight`, `italic`, `textAlignHorizontal` (LEFT/CENTER/RIGHT/JUSTIFIED), `lineHeight`, `letterSpacing`

**Auto Layout (on frames):** `layoutMode` (NONE/HORIZONTAL/VERTICAL), `itemSpacing`, `paddingTop/Right/Bottom/Left`, `primaryAxisAlign` (MIN/CENTER/MAX/SPACE_BETWEEN), `counterAxisAlign` (MIN/CENTER/MAX/STRETCH)

**Fill/Stroke format:**
```json
{ "type": "SOLID", "color": { "r": 0.23, "g": 0.51, "b": 0.96, "a": 1 }, "opacity": 1, "visible": true }
```

Colors use 0-1 range (not 0-255). The convenience `fill="#hex"` and `stroke="#hex"` params in add/update tools handle conversion automatically.

## Common Patterns

### Card Component
```
batch_design_operations(designId, operations=[
  { op: "add", type: "FRAME", nodeId: "card", properties: { name: "Card", width: 320, height: 200, fill: "#FFFFFF", cornerRadius: 12, layoutMode: "VERTICAL", padding: 16, itemSpacing: 8 } },
  { op: "add", type: "TEXT", parentId: "card", properties: { text: "Title", fontSize: 18, fontWeight: 600 } },
  { op: "add", type: "TEXT", parentId: "card", properties: { text: "Description text", fontSize: 14, fill: "#6B7280" } },
])
```

### Button
```
add_design_node(type="FRAME", name="Button", width=120, height=40, fill="#3B82F6", cornerRadius=8, layoutMode="HORIZONTAL", padding=12)
# Then add text child to the button frame
```

### Form Layout
```
batch_design_operations(designId, operations=[
  { op: "add", type: "FRAME", nodeId: "form", properties: { name: "Form", width: 400, layoutMode: "VERTICAL", itemSpacing: 16, padding: 24, fill: "#FFFFFF", cornerRadius: 12 } },
  { op: "add", type: "TEXT", parentId: "form", properties: { text: "Sign In", fontSize: 24, fontWeight: 700 } },
  { op: "add", type: "FRAME", nodeId: "email", parentId: "form", properties: { name: "Email Input", width: 352, height: 44, fill: "#F9FAFB", cornerRadius: 8, stroke: "#D1D5DB" } },
  { op: "add", type: "FRAME", nodeId: "pass", parentId: "form", properties: { name: "Password Input", width: 352, height: 44, fill: "#F9FAFB", cornerRadius: 8, stroke: "#D1D5DB" } },
  { op: "add", type: "FRAME", nodeId: "btn", parentId: "form", properties: { name: "Submit Button", width: 352, height: 44, fill: "#3B82F6", cornerRadius: 8 } },
])
```

## Tips

1. Use `batch_design_operations` for multi-node designs — it's one API call and supports temp ID references
2. Colors in convenience params are hex strings (`#3B82F6`), but in raw fills/strokes they're `{ r, g, b, a }` with 0-1 range
3. Auto-layout frames automatically position children — set `layoutMode` and `itemSpacing`
4. Text nodes default to `textAutoResize: "HEIGHT"` so width is fixed but height adjusts to content
5. The design renders in real-time in the browser via CanvasKit WebGL
