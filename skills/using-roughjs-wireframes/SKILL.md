---
name: using-roughjs-wireframes
description: Use when creating UI mockups and wireframes with rough hand-drawn styling for design collaboration and prototyping
model: sonnet
---

# Using Rough.js Wireframes

## Overview

**Rough.js wireframes create hand-drawn style UI mockups** that feel informal and invite collaboration. Unlike polished mockups, rough wireframes signal "this is not final" and encourage feedback early in design.

The mermaid-collab system uses **JSON component syntax** (not traditional wireframe markup) to define wireframes that render with rough.js styling. This skill teaches the syntax, patterns, and best practices for creating effective wireframes.

## When to Use

Use this skill when:
- Creating UI prototypes to show to stakeholders early
- Designing interaction flows visually before implementation
- Rapidly iterating on layouts without worrying about polish
- Collaborating on interface design with non-designers
- Building sketches to validate UX concepts

**NOT for:**
- Final production UI (use proper CSS/components)
- Complex animations or interactions
- High-fidelity designs (use Figma/Adobe tools)
- Data visualization requiring precision

## Quick Reference

### Wireframe Root Structure

Every wireframe requires this root structure:

```json
{
  "viewport": "mobile",
  "direction": "LR",
  "screens": [
    {
      "id": "screen-1",
      "type": "screen",
      "name": "Screen Name",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "children": [...]
    }
  ]
}
```

**Required root fields:**
- `viewport`: `"mobile"` (375px), `"tablet"` (768px), or `"desktop"` (1200px)
- `direction`: `"LR"` (screens left-to-right) or `"TD"` (screens top-down)
- `screens`: Array of screen components

### Basic Component Structure

All components follow this pattern:

```json
{
  "id": "unique-id",
  "type": "componentType",
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
  ...type-specific properties
}
```

**Required for all components:**
- `id`: Unique identifier string
- `type`: Component type (lowercase)
- `bounds`: Position/size object (see "How Bounds Work" section)

### Available Component Types

| Component | Purpose | Key Properties |
|-----------|---------|----------------|
| **screen** | Top-level container | `name`, `children` |
| **col** | Vertical layout | `children`, `gap`, `padding` |
| **row** | Horizontal layout | `children`, `gap`, `padding` |
| **card** | Grouped content box | `title`, `children`, `padding` |
| **button** | Interactive element | `label`, `variant` (primary/secondary/danger) |
| **input** | Text entry field | `placeholder`, `label` |
| **text** | Display text | `content` |
| **title** | Heading text | `content` |
| **appbar** | Top app bar | `title`, `leftIcon`, `rightIcons` |
| **bottomnav** | Bottom navigation | `items` (array of {icon, label, active}) |
| **navmenu** | Navigation menu | `items` (array of {icon, label, active}) |
| **avatar** | User avatar | `initials`, `size` |
| **icon** | Icon display | `name` |
| **image** | Image placeholder | `alt` |
| **list** | List of items | `items` (array of {primary, secondary}) |
| **divider** | Visual separator | (no special props) |

### Common Patterns

**Simple login form:**
```json
{
  "viewport": "mobile",
  "direction": "LR",
  "screens": [{
    "id": "login",
    "type": "screen",
    "name": "Login",
    "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "children": [{
      "id": "login-form",
      "type": "col",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "padding": 16,
      "gap": 16,
      "children": [
        { "id": "title", "type": "title", "content": "Sign In", "bounds": { "x": 0, "y": 0, "width": 0, "height": 32 } },
        { "id": "email", "type": "input", "label": "Email", "placeholder": "Enter email", "bounds": { "x": 0, "y": 0, "width": 0, "height": 56 } },
        { "id": "password", "type": "input", "label": "Password", "placeholder": "Enter password", "bounds": { "x": 0, "y": 0, "width": 0, "height": 56 } },
        { "id": "submit", "type": "button", "label": "Sign In", "variant": "primary", "bounds": { "x": 0, "y": 0, "width": 0, "height": 48 } }
      ]
    }]
  }]
}
```

**App with header, content, and bottom nav:**
```json
{
  "viewport": "mobile",
  "direction": "LR",
  "screens": [{
    "id": "home",
    "type": "screen",
    "name": "Home",
    "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "children": [
      {
        "id": "header",
        "type": "appbar",
        "title": "My App",
        "leftIcon": "menu",
        "bounds": { "x": 0, "y": 0, "width": 0, "height": 56 }
      },
      {
        "id": "content",
        "type": "col",
        "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
        "padding": 16,
        "gap": 12,
        "children": [
          { "id": "welcome", "type": "title", "content": "Welcome", "bounds": { "x": 0, "y": 0, "width": 0, "height": 32 } },
          { "id": "desc", "type": "text", "content": "Main content goes here", "bounds": { "x": 0, "y": 0, "width": 0, "height": 24 } }
        ]
      },
      {
        "id": "nav",
        "type": "bottomnav",
        "bounds": { "x": 0, "y": 0, "width": 0, "height": 60 },
        "items": [
          { "icon": "home", "label": "Home", "active": true },
          { "icon": "search", "label": "Search" },
          { "icon": "settings", "label": "Settings" }
        ]
      }
    ]
  }]
}
```

**Multiple screens side-by-side:**
```json
{
  "viewport": "mobile",
  "direction": "LR",
  "screens": [
    {
      "id": "list",
      "type": "screen",
      "name": "Product List",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "children": [...]
    },
    {
      "id": "detail",
      "type": "screen",
      "name": "Product Detail",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "children": [...]
    }
  ]
}
```

## Screen Layout Convention

**Always wrap screen content in a padded col container** for consistent spacing across screens.

### The Pattern

```
Screen
├── appbar (full-bleed, no padding)
├── col (padding: 16, gap: 12) ← Content wrapper
│   ├── content components...
│   ├── cards, inputs, text...
│   └── buttons...
└── bottomnav (full-bleed, no padding)
```

### Why This Matters

AppBar and BottomNav are "full-bleed" components that span the full screen width. All other content needs consistent horizontal padding. Without a wrapper col, each component relies only on the screen's built-in padding (12px), which looks tight.

**With wrapper col (padding: 16):**
- Content gets col padding (16px) + screen padding (12px) = 28px from edge
- Consistent spacing across all screens
- Cards, inputs, and buttons all align properly

**Without wrapper col:**
- Content only gets screen padding (12px)
- Looks cramped compared to screens with wrapper col
- Inconsistent appearance across your wireframes

### Correct Structure

```json
{
  "id": "my-screen",
  "type": "screen",
  "name": "My Screen",
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "children": [
    {
      "id": "appbar",
      "type": "appbar",
      "title": "Title",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 56 }
    },
    {
      "id": "content",
      "type": "col",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "padding": 16,
      "gap": 12,
      "children": [
        { "id": "card1", "type": "card", "title": "Info", "bounds": { "x": 0, "y": 0, "width": 0, "height": 100 }, "children": [...] },
        { "id": "input1", "type": "input", "placeholder": "Enter value", "bounds": { "x": 0, "y": 0, "width": 0, "height": 48 } },
        { "id": "btn", "type": "button", "label": "Submit", "variant": "primary", "bounds": { "x": 0, "y": 0, "width": 0, "height": 48 } }
      ]
    },
    {
      "id": "bottomnav",
      "type": "bottomnav",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 60 },
      "items": [...]
    }
  ]
}
```

### Incorrect Structure (Avoid)

```json
{
  "id": "my-screen",
  "type": "screen",
  "name": "My Screen",
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "children": [
    { "id": "appbar", "type": "appbar", ... },
    { "id": "card1", "type": "card", ... },
    { "id": "input1", "type": "input", ... },
    { "id": "btn", "type": "button", ... }
  ]
}
```

This places components as direct screen children without the wrapper col, resulting in inconsistent/tight padding.

## Tool Usage

### Create a Wireframe

Use the `create_wireframe` tool with the `mermaid-collab` MCP server:

```
Tool: mcp__mermaid__create_wireframe
Args: {
  "project": "/absolute/path/to/project",
  "session": "session-name",
  "name": "my-wireframe",
  "content": {
    "viewport": "mobile",
    "direction": "LR",
    "screens": [...]
  }
}
```

Returns: `{ success: true, id, previewUrl }`

### Update a Wireframe

```
Tool: mcp__mermaid__update_wireframe
Args: {
  "project": "/absolute/path/to/project",
  "session": "session-name",
  "id": "wireframe-id",
  "content": { ... updated wireframe ... }
}
```

### View a Wireframe

After creation, the preview URL renders your wireframe with:
- Rough hand-drawn styling
- Automatic theme support (light/dark mode)
- Responsive sizing

Open the preview URL in a browser to see the rendered wireframe.

## Theming

Wireframes **automatically adapt** to the app's current theme - no configuration needed.

### How It Works

1. **Automatic detection**: Wireframes detect the app's theme from `useTheme()` hook
2. **Full color palettes**: Separate light and dark color schemes for all components
3. **No syntax changes**: Same wireframe JSON works in both modes

### What Changes in Dark Mode

| Component | Light Mode | Dark Mode |
|-----------|------------|-----------|
| **Screen background** | White (`#ffffff`) | Dark gray (`#111827`) |
| **Card background** | White | Dark (`#1f2937`) |
| **Text** | Dark gray | Light gray |
| **Primary buttons** | Dark fill, white text | Blue fill, white text |
| **Input fields** | White bg, gray border | Dark bg, lighter border |
| **Navigation** | Light bg | Dark bg with lighter text |

### Best Practices

1. **Don't hardcode colors**: Use variants (`primary`, `secondary`) not hex colors
2. **Test both themes**: Toggle dark mode to verify readability
3. **Use semantic variants**: `danger` for destructive actions, `success` for confirmations
4. **Trust the defaults**: The color system is designed for contrast in both modes

### Example: Same Wireframe, Both Themes

This wireframe automatically adapts to light/dark mode:

```json
{
  "viewport": "mobile",
  "direction": "LR",
  "screens": [{
    "id": "dashboard",
    "type": "screen",
    "name": "Dashboard",
    "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "children": [{
      "id": "content",
      "type": "col",
      "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "padding": 16,
      "gap": 16,
      "children": [
        { "id": "title", "type": "title", "content": "Dashboard", "bounds": { "x": 0, "y": 0, "width": 0, "height": 32 } },
        { "id": "save", "type": "button", "label": "Save", "variant": "primary", "bounds": { "x": 0, "y": 0, "width": 0, "height": 48 } },
        { "id": "cancel", "type": "button", "label": "Cancel", "variant": "secondary", "bounds": { "x": 0, "y": 0, "width": 0, "height": 48 } }
      ]
    }]
  }]
}
```

- In **light mode**: Dark heading text, dark primary button, outlined secondary
- In **dark mode**: Light heading text, blue primary button, filled secondary

## Component Details

### Text Component

Display body text:

```json
{ "id": "txt-1", "type": "text", "content": "Regular paragraph text", "bounds": { "x": 0, "y": 0, "width": 0, "height": 24 } }
```

**Properties:**
- `content` - The text to display (required)
- `fontSize` - Optional custom font size
- `fontWeight` - Optional: "normal" or "bold"
- `color` - Optional custom color

### Title Component

Display heading text (larger, bolder):

```json
{ "id": "title-1", "type": "title", "content": "Page Title", "bounds": { "x": 0, "y": 0, "width": 0, "height": 32 } }
```

**Properties:**
- `content` - The heading text (required)
- `fontSize` - Optional custom font size (default: 24)

### Input Component

Text entry fields:

```json
{ "id": "input-1", "type": "input", "label": "Email", "placeholder": "Enter email", "bounds": { "x": 0, "y": 0, "width": 0, "height": 56 } }
```

**Properties:**
- `label` - Label displayed above input
- `placeholder` - Gray hint text inside input

### Button Component

Interactive trigger elements:

```json
{ "id": "btn-1", "type": "button", "label": "Submit", "variant": "primary", "bounds": { "x": 0, "y": 0, "width": 0, "height": 48 } }
{ "id": "btn-2", "type": "button", "label": "Cancel", "variant": "secondary", "bounds": { "x": 0, "y": 0, "width": 0, "height": 48 } }
{ "id": "btn-3", "type": "button", "label": "Delete", "variant": "danger", "bounds": { "x": 0, "y": 0, "width": 0, "height": 48 } }
```

**Properties:**
- `label` - Button text (required)
- `variant` - "primary", "secondary", or "danger"

### Col Component (Vertical Layout)

Stack children vertically:

```json
{
  "id": "col-1",
  "type": "col",
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "padding": 16,
  "gap": 12,
  "children": [...]
}
```

**Properties:**
- `children` - Array of child components (required)
- `gap` - Spacing between children in pixels
- `padding` - Internal padding in pixels

### Row Component (Horizontal Layout)

Arrange children horizontally:

```json
{
  "id": "row-1",
  "type": "row",
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 60 },
  "gap": 8,
  "children": [...]
}
```

**Properties:**
- `children` - Array of child components (required)
- `gap` - Spacing between children in pixels

### Card Component

Grouped content with optional title:

```json
{
  "id": "card-1",
  "type": "card",
  "title": "Card Title",
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 120 },
  "padding": 12,
  "children": [...]
}
```

**Properties:**
- `title` - Optional card header text
- `children` - Array of child components (required)
- `padding` - Internal padding in pixels

### AppBar Component

Top application bar:

```json
{
  "id": "appbar-1",
  "type": "appbar",
  "title": "Screen Title",
  "leftIcon": "menu",
  "rightIcons": ["search", "more"],
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 56 }
}
```

**Properties:**
- `title` - Center title text
- `leftIcon` - Icon name for left side (e.g., "menu", "back")
- `rightIcons` - Array of icon names for right side

### BottomNav Component

Bottom navigation bar:

```json
{
  "id": "bottomnav-1",
  "type": "bottomnav",
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 60 },
  "items": [
    { "icon": "home", "label": "Home", "active": true },
    { "icon": "search", "label": "Search" },
    { "icon": "settings", "label": "Settings" }
  ]
}
```

**Properties:**
- `items` - Array of navigation items (required)
  - `icon` - Icon name
  - `label` - Text label
  - `active` - Boolean, highlights if true

### NavMenu Component

Drawer/sidebar navigation menu:

```json
{
  "id": "navmenu-1",
  "type": "navmenu",
  "bounds": { "x": 0, "y": 0, "width": 280, "height": 0 },
  "items": [
    { "icon": "home", "label": "Home", "active": true },
    { "icon": "inventory", "label": "Inventory" },
    { "icon": "settings", "label": "Settings" }
  ]
}
```

### List Component

Display a list of items:

```json
{
  "id": "list-1",
  "type": "list",
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "items": [
    { "primary": "Item 1", "secondary": "Description" },
    { "primary": "Item 2", "secondary": "Description" }
  ]
}
```

**Properties:**
- `items` - Array of list items (required)
  - `primary` - Main text
  - `secondary` - Optional secondary text

### Avatar Component

User avatar circle:

```json
{ "id": "avatar-1", "type": "avatar", "initials": "JD", "bounds": { "x": 0, "y": 0, "width": 40, "height": 40 } }
```

**Properties:**
- `initials` - 1-2 character initials to display
- `size` - Optional size (default based on bounds)

## Common Mistakes

### Mistake 1: Missing Required Fields
Every component needs `id`, `type`, and `bounds`.

**Bad:**
```json
{ "type": "text", "content": "Hello" }
```

**Good:**
```json
{ "id": "txt-1", "type": "text", "content": "Hello", "bounds": { "x": 0, "y": 0, "width": 0, "height": 24 } }
```

### Mistake 2: Wrong Bounds for Layout Intent
Setting explicit width/height when you want flexible sizing, or vice versa.

**Bad (wants full width but sets fixed):**
```json
{ "id": "btn", "type": "button", "label": "Submit", "bounds": { "x": 0, "y": 0, "width": 100, "height": 48 } }
```

**Good (full width button):**
```json
{ "id": "btn", "type": "button", "label": "Submit", "bounds": { "x": 0, "y": 0, "width": 0, "height": 48 } }
```

### Mistake 3: Nesting Too Deeply
Keep structures shallow - wireframes should feel simple and sketchy.

**Bad:**
```json
{
  "id": "c1", "type": "col", "bounds": {...},
  "children": [{
    "id": "c2", "type": "col", "bounds": {...},
    "children": [{
      "id": "c3", "type": "col", "bounds": {...},
      "children": [{ "id": "txt", "type": "text", ... }]
    }]
  }]
}
```

**Good:**
```json
{
  "id": "content", "type": "col", "bounds": {...}, "gap": 12,
  "children": [
    { "id": "title", "type": "title", "content": "Title", "bounds": {...} },
    { "id": "desc", "type": "text", "content": "Description", "bounds": {...} }
  ]
}
```

### Mistake 4: Using Props-Based Syntax
The wireframe system uses flat properties, not a `props` wrapper.

**Bad (old syntax):**
```json
{ "type": "Button", "props": { "text": "Click", "variant": "primary" } }
```

**Good (correct syntax):**
```json
{ "id": "btn", "type": "button", "label": "Click", "variant": "primary", "bounds": {...} }
```

### Mistake 5: Missing Children Array for Containers
Container types (col, row, card, screen) require a `children` array.

**Bad:**
```json
{ "id": "col-1", "type": "col", "bounds": {...} }
```

**Good:**
```json
{ "id": "col-1", "type": "col", "bounds": {...}, "children": [] }
```

## Real-World Impact

**Why rough wireframes?**

1. **Psychological effect** - Polished mockups shut down feedback ("looks done!"). Rough sketches invite revision ("just a draft").

2. **Speed** - JSON structure is faster to create than pixel-perfect Figma designs.

3. **Collaboration** - Hand-drawn style signals early-stage thinking, encouraging stakeholders to suggest changes.

4. **Testability** - You can create multiple variants quickly to validate different interaction patterns.

5. **Handoff clarity** - Wireframe shows layout intent; designers and developers know it's not the final visual design.

## Workflow Integration

### Typical Flow

1. **Sketch** - Create wireframe with basic layout and key interactions
2. **Review** - Share preview URL, gather feedback
3. **Iterate** - Update wireframe based on feedback
4. **Hand off** - Link wireframe in design document for reference
5. **Implement** - Developers use wireframe as specification for component structure

### With Mermaid-Collab

Wireframes live in your collab session alongside:
- Design documents explaining decisions
- Diagrams showing data flow
- Specs linking to implementation tasks

## Critical: How Bounds Work

**This is the most important concept for creating wireframes that render correctly.**

Every component requires a `bounds` object with `x`, `y`, `width`, and `height`. However, these values are NOT used the way you might expect:

### Position vs Size

| Property | Purpose | Who Uses It |
|----------|---------|-------------|
| `bounds.x` | **IGNORED** | Parent calculates actual position |
| `bounds.y` | **IGNORED** | Parent calculates actual position |
| `bounds.width` | **SIZE HINT** | Used for layout calculation |
| `bounds.height` | **SIZE HINT** | Used for layout calculation |

### The Flex Layout Algorithm

The renderer uses a flexbox-style algorithm:

1. **Parent controls position** - Children are positioned by their parent container based on direction (row/col), gap, and alignment
2. **Children specify size** - `width` and `height` in bounds are size hints
3. **Flex behavior**:
   - If `flex` property is set explicitly, it overrides bounds size
   - If `flex` is NOT set and bounds has explicit size > 0, component uses that size (flex: 0 behavior)
   - If `flex` is NOT set and bounds size is 0, component stretches to fill available space (flex: 1 behavior)

### Practical Examples

**Fixed-size component (respects explicit bounds):**
```json
{
  "type": "button",
  "id": "btn-1",
  "label": "Submit",
  "bounds": { "x": 0, "y": 0, "width": 100, "height": 40 }
}
```
This button will be 100×40 pixels. The x/y values are ignored.

**Stretching component (fills available space):**
```json
{
  "type": "col",
  "id": "content",
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "children": [...]
}
```
This column will stretch to fill its parent because width/height are 0.

**Mixed fixed and flexible:**
```json
{
  "type": "col",
  "id": "layout",
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "children": [
    { "type": "appbar", "id": "header", "bounds": { "x": 0, "y": 0, "width": 0, "height": 56 }, ... },
    { "type": "col", "id": "content", "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 }, "children": [...] },
    { "type": "bottomnav", "id": "nav", "bounds": { "x": 0, "y": 0, "width": 0, "height": 60 }, ... }
  ]
}
```
- AppBar: fixed 56px height, full width
- Content: stretches to fill remaining space
- BottomNav: fixed 60px height, full width

### Common Patterns

**Always set x/y to 0** - They're ignored anyway:
```json
"bounds": { "x": 0, "y": 0, "width": 375, "height": 48 }
```

**Use 0 for flexible dimensions:**
```json
"bounds": { "x": 0, "y": 0, "width": 0, "height": 48 }  // Full width, fixed height
"bounds": { "x": 0, "y": 0, "width": 120, "height": 0 }  // Fixed width, flexible height
"bounds": { "x": 0, "y": 0, "width": 0, "height": 0 }    // Stretch both ways
```

### Why This Matters

If you set explicit `width` or `height` values, the component will use those exact sizes. If you want a component to stretch and fill available space, set those dimensions to `0`.

This allows you to create layouts like:
- Fixed headers (56px) with stretching content areas
- Side-by-side cards with equal widths (all set to 0)
- Fixed-width buttons in a row with flexible spacers

## Syntax Validation

The system validates all wireframe JSON before rendering. Common errors:

- Missing `type` field
- Invalid component type
- Malformed `children` array
- Invalid `variant` or `direction` value
- Missing `bounds` object
- Missing `id` field

If validation fails, you'll see an error message with the path to the invalid field. Check the JSON structure against the component reference above.

## Advanced: Combining with Other Tools

### Link Wireframe in Design Document

In a markdown document, reference your wireframe by ID:

```markdown
## Product List Screen

See the wireframe: `inventory-screens` (wireframe ID)

Preview: http://localhost:3737/wireframe.html?project=...&session=...&id=inventory-screens

### Design Notes
- Search input at top with filter buttons
- List items show SKU, location, quantity
- Tap item to see detail screen
```

### Show Multiple Screens in One Wireframe

Use the `direction` and multiple screens to show a flow:

```json
{
  "viewport": "mobile",
  "direction": "LR",
  "screens": [
    { "id": "list", "type": "screen", "name": "List View", ... },
    { "id": "detail", "type": "screen", "name": "Detail View", ... },
    { "id": "edit", "type": "screen", "name": "Edit View", ... }
  ]
}
```

This renders three screens side-by-side (LR) showing the progression.

### Sketch Structure First

Before writing JSON, sketch the component tree:

```
Screen: Home
├── appbar [title: "Home", leftIcon: "menu"]
├── col [padding: 16, gap: 12]
│   ├── title [content: "Welcome"]
│   ├── card [title: "Quick Actions"]
│   │   └── row [gap: 8]
│   │       ├── button [label: "Inventory"]
│   │       ├── button [label: "Picking"]
│   │       └── button [label: "Shipping"]
│   └── card [title: "Recent Activity"]
│       └── list [items: ...]
└── bottomnav [items: Home, Search, Settings]
```

Then convert to JSON with proper `id`, `type`, and `bounds` for each.

## Bottom Line

**Rough.js wireframes are for early-stage design collaboration.** Use them to:
- Show layout and information architecture
- Test interaction flows
- Invite stakeholder feedback
- Document design decisions

Don't use them for:
- Final visual design (use proper design tools)
- Precise styling (that's CSS/component work)
- Animation/complex interaction (prototype separately)

Keep wireframes simple, semantic, and focused on structural decisions. The rough styling does the talking: "This is not final, let's iterate together."
