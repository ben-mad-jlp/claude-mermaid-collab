---
name: wireframing
description: Use when creating UI wireframes with the mermaid-collab design MCP tools (create_design, create_design_from_tree, add_design_node). Covers correct property names, layout patterns, and common UI components.
---

# Wireframing with mermaid-collab Design Tools

## Overview

The design tools use a scene graph format. Trees passed to `create_design` and `create_design_from_tree` are recursively built into nodes using `createDefaultNode` + `applyConvenienceProps`. Property names must match the SerializedNode schema exactly.

## Critical Property Names

These are the most common mistakes — wrong property names silently produce invisible/broken nodes:

| What you want | ✅ Correct | ❌ Wrong |
|---------------|-----------|---------|
| Text content | `"text": "Hello"` | `"content": "Hello"` |
| Bold text | `"fontWeight": 700` | `"fontWeight": "bold"` |
| Auto-layout gap | `"itemSpacing": 16` | `"spacing": 16`, `"gap": 16` |
| Background color | `"fill": "#ffffff"` | `"background": "#fff"` |
| Border color | `"stroke": "#e2e8f0"` | `"border": "#e2e8f0"` |
| Border radius | `"cornerRadius": 8` | `"borderRadius": 8` |
| Font size | `"fontSize": 14` | (correct) |

**fontWeight is always a number:** 400 (regular), 600 (semibold), 700 (bold)

## Scene Graph Basics

`create_design` accepts a tree spec and auto-converts to scene graph:

```json
{
  "type": "CANVAS",
  "children": [{
    "type": "PAGE",
    "name": "My Screens",
    "width": 3200,
    "height": 1400
  }]
}
```

`create_design_from_tree` adds nodes to the first PAGE. Always provide `x`, `y` for absolute positioning.

## Node Types

| Type | Use for |
|------|---------|
| `FRAME` | Containers, sections, cards, bars — everything structural |
| `TEXT` | All text. Requires `text` property |
| `RECTANGLE` | Standalone shapes (rarely needed — use FRAME with fill) |

## Layout Modes

```json
{ "layoutMode": "VERTICAL" }   // Stack children top-to-bottom
{ "layoutMode": "HORIZONTAL" } // Stack children left-to-right
{ "layoutMode": "NONE" }       // Absolute positioning (default)
```

### Auto-layout (VERTICAL / HORIZONTAL)

Uses Yoga (flexbox) under the hood. Key rules:

- Children's `x`/`y` are ignored — they stack automatically
- Use `gap` (or `itemSpacing`) for spacing between children
- **Sizing defaults to HUG** — containers grow to fit their children
- If you provide an explicit `width` (for VERTICAL) or `height` (for HORIZONTAL), that axis stays FIXED
- TEXT nodes inside auto-layout use their `height` property — set explicit height for multi-line text

### Sizing modes

| Mode | Behavior | When applied |
|------|----------|-------------|
| `HUG` | Grows to fit children | Default when no explicit primary-axis size |
| `FIXED` | Uses explicit width/height | Default when you provide width or height |
| `FILL` | Expands to fill parent | Set `layoutGrow: 1` on the child |

You can override with `primaryAxisSizing` and `counterAxisSizing` props.

### Recommended pattern: auto-layout with explicit widths

For best results, set `layoutMode: "VERTICAL"` with an explicit `width` on sections, and let height HUG. Set explicit `width` on TEXT nodes to control wrapping.

```json
{
  "type": "FRAME", "layoutMode": "VERTICAL", "width": 900, "gap": 12, "padding": 24,
  "children": [
    { "type": "TEXT", "text": "Title", "fontSize": 17, "fontWeight": 700, "width": 852 },
    { "type": "TEXT", "text": "Long description here...", "fontSize": 13, "width": 852, "height": 40 }
  ]
}
```

### Absolute positioning (NONE — default)

Set explicit `x`, `y` on each child. Good for precise control over small components (nav bars, rows with status badges).

## Convenience Props (auto-translated)

These shorthand props work in tree specs:

```json
{ "fill": "#3b82f6" }      → fills: [{ type: "SOLID", color: {...}, opacity: 1 }]
{ "stroke": "#e2e8f0" }    → strokes: [{ color: {...}, weight: 1 }]
{ "padding": 16 }          → paddingTop/Right/Bottom/Left: 16
{ "gap": 12 }              → itemSpacing: 12
{ "align": "CENTER" }      → counterAxisAlign: "CENTER"
{ "justify": "CENTER" }    → primaryAxisAlign: "CENTER"
```

## Common UI Patterns

### Navigation Bar
```json
{
  "type": "FRAME", "name": "NavBar",
  "width": 900, "height": 56, "fill": "#1e293b",
  "children": [
    { "type": "TEXT", "text": "App Title", "fontSize": 18, "fontWeight": 700, "fill": "#ffffff", "x": 20, "y": 18 },
    { "type": "TEXT", "text": "User Name", "fontSize": 13, "fill": "#94a3b8", "x": 760, "y": 20 }
  ]
}
```

### Progress Bar
```json
{
  "type": "FRAME", "width": 844, "height": 16, "fill": "#e2e8f0", "cornerRadius": 8, "x": 28, "y": 80,
  "children": [
    { "type": "FRAME", "name": "Fill", "width": 210, "height": 16, "fill": "#3b82f6", "cornerRadius": 8 }
  ]
}
```
Outer = track (gray), inner = fill (colored). Width of inner = progress %.

### Card
```json
{
  "type": "FRAME", "name": "Card",
  "width": 270, "height": 180,
  "fill": "#f8fafc", "stroke": "#e2e8f0", "cornerRadius": 12,
  "children": [
    { "type": "TEXT", "text": "Card Title", "fontSize": 14, "fontWeight": 700, "fill": "#0f172a", "x": 20, "y": 20 },
    { "type": "TEXT", "text": "Subtitle text here", "fontSize": 11, "fill": "#64748b", "x": 20, "y": 44 }
  ]
}
```

### Tab Bar
```json
{
  "type": "FRAME", "width": 852, "height": 28, "x": 24, "y": 48,
  "children": [
    { "type": "FRAME", "width": 50, "height": 28, "fill": "#3b82f6", "cornerRadius": 6, "x": 0,
      "children": [{ "type": "TEXT", "text": "All", "fontSize": 11, "fill": "#ffffff", "x": 14, "y": 6 }] },
    { "type": "FRAME", "width": 56, "height": 28, "fill": "#f1f5f9", "cornerRadius": 6, "x": 58,
      "children": [{ "type": "TEXT", "text": "Tab 2", "fontSize": 11, "fill": "#64748b", "x": 10, "y": 6 }] }
  ]
}
```
Note: Tab x positions must be set manually (not auto-layout) so they're predictable.

### List Row (with status indicator)
```json
{
  "type": "FRAME", "name": "Row",
  "width": 852, "height": 48,
  "fill": "#f8fafc", "stroke": "#e2e8f0", "cornerRadius": 8, "x": 24, "y": 84,
  "children": [
    { "type": "FRAME", "width": 5, "height": 24, "fill": "#10b981", "cornerRadius": 3, "x": 14, "y": 12 },
    { "type": "TEXT", "text": "item-name", "fontSize": 13, "fontWeight": 700, "fill": "#0f172a", "x": 32, "y": 8 },
    { "type": "TEXT", "text": "Subtitle", "fontSize": 11, "fill": "#64748b", "x": 32, "y": 28 },
    { "type": "TEXT", "text": "explored", "fontSize": 11, "fill": "#10b981", "x": 780, "y": 16 }
  ]
}
```
Left color bar: green (#10b981) = done, gray (#e2e8f0) = not started.

### Search Box
```json
{
  "type": "FRAME", "name": "Search",
  "width": 300, "height": 36, "fill": "#f1f5f9", "stroke": "#e2e8f0", "cornerRadius": 8, "x": 576, "y": 8,
  "children": [
    { "type": "TEXT", "text": "Search...", "fontSize": 13, "fill": "#94a3b8", "x": 12, "y": 10 }
  ]
}
```

### Two-Column Layout (main + sidebar)
```json
{
  "type": "FRAME", "name": "Body", "width": 900, "height": 500, "x": 0, "y": 200,
  "children": [
    { "type": "FRAME", "name": "Main", "width": 580, "height": 500, "fill": "#ffffff", "x": 0, "y": 0 },
    { "type": "FRAME", "name": "Sidebar", "width": 300, "height": 500, "fill": "#f8fafc", "stroke": "#e2e8f0", "x": 596, "y": 0 }
  ]
}
```

## Color Palette (Reference)

| Token | Hex | Use |
|-------|-----|-----|
| Background dark | `#1e293b` | Nav bars, headers |
| Background light | `#f8fafc` | Cards, rows |
| Background accent | `#f0f9ff` | Hero sections |
| Border | `#e2e8f0` | Card borders, dividers |
| Text primary | `#0f172a` | Headings, labels |
| Text secondary | `#64748b` | Subtitles, descriptions |
| Text muted | `#94a3b8` | Placeholders, metadata |
| Blue (active/CTA) | `#3b82f6` | Buttons, progress, active tabs |
| Green (success) | `#10b981` | Explored, complete |
| Yellow accent | `#fef3c7` | Warning, scanner |
| Purple accent | `#ede9fe` | AI, Sofia |

## Screen Sizing

Standard desktop wireframe width: **900px**

Place multiple screens side-by-side on the page with 80px gaps:
- Screen 1: `x: 0`
- Screen 2: `x: 980`
- Screen 3: `x: 1960`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Text invisible | Use `"text"` not `"content"` |
| Text all same weight | `fontWeight` must be a number (700), not `"bold"` |
| Children overlapping in auto-layout | Remove individual `x`/`y` from children when using `layoutMode` |
| Frame has no background | Add `"fill": "#ffffff"` — default is transparent |
| Border not showing | `"stroke"` sets color; optionally add `"strokeWeight": 1` |
| Text vertically cut off | TEXT nodes default to `textAutoResize: "HEIGHT"` — set explicit height if needed |
