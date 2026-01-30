---
name: using-roughjs-wireframes
description: Use when creating UI mockups and wireframes with rough hand-drawn styling for design collaboration and prototyping
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

### Basic Component Structure

All wireframe components follow this JSON pattern:

```json
{
  "type": "ComponentType",
  "props": {
    "children": ["text or nested components"],
    "variant": "optional styling variant"
  }
}
```

### Available Component Types

| Component | Purpose | Props |
|-----------|---------|-------|
| **Button** | Interactive element | text, variant (primary/secondary/danger), onClick |
| **Input** | Text entry field | placeholder, type, label |
| **Text** | Display text/labels | children, variant (heading/body/caption) |
| **Container** | Layout wrapper | direction (row/col), children, gap |
| **Card** | Grouped content box | title, children, variant |
| **Navigation** | Header/sidebar navigation | items (array of {label, active}) |
| **Display** | Read-only text/list | content, type (list/paragraph) |

### Common Patterns

**Simple form layout:**
```json
{
  "type": "Container",
  "props": {
    "direction": "col",
    "gap": "medium",
    "children": [
      { "type": "Text", "props": { "variant": "heading", "children": ["Login Form"] } },
      { "type": "Input", "props": { "placeholder": "Email", "label": "Email" } },
      { "type": "Input", "props": { "placeholder": "Password", "type": "password", "label": "Password" } },
      { "type": "Button", "props": { "text": "Sign In", "variant": "primary" } }
    ]
  }
}
```

**Card grid layout:**
```json
{
  "type": "Container",
  "props": {
    "direction": "row",
    "gap": "large",
    "children": [
      {
        "type": "Card",
        "props": {
          "title": "Feature 1",
          "children": [
            { "type": "Text", "props": { "variant": "body", "children": ["Description here"] } }
          ]
        }
      },
      {
        "type": "Card",
        "props": {
          "title": "Feature 2",
          "children": [
            { "type": "Text", "props": { "variant": "body", "children": ["Description here"] } }
          ]
        }
      }
    ]
  }
}
```

**Navigation with content:**
```json
{
  "type": "Container",
  "props": {
    "direction": "col",
    "children": [
      {
        "type": "Navigation",
        "props": {
          "items": [
            { "label": "Home", "active": true },
            { "label": "Features", "active": false },
            { "label": "Pricing", "active": false },
            { "label": "About", "active": false }
          ]
        }
      },
      {
        "type": "Container",
        "props": {
          "direction": "col",
          "gap": "large",
          "children": [
            { "type": "Text", "props": { "variant": "heading", "children": ["Welcome"] } },
            { "type": "Text", "props": { "variant": "body", "children": ["Main content goes here"] } }
          ]
        }
      }
    ]
  }
}
```

## Tool Usage

### Create a Wireframe

Use the `create_wireframe` tool with the `mermaid-collab` MCP server:

```
Tool: create_wireframe
Args: {
  "project": "/path/to/project",
  "session": "session-name",
  "name": "my-wireframe",
  "content": { ... JSON component structure ... }
}
```

Returns: `{ id, previewUrl, message }`

### View a Wireframe

After creation, the preview URL renders your wireframe with:
- Rough hand-drawn styling
- Automatic theme support (light/dark mode)
- Responsive sizing
- Interactive component feedback

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

This wireframe automatically adapts:

```json
{
  "type": "Container",
  "props": {
    "direction": "col",
    "children": [
      { "type": "Text", "props": { "variant": "heading", "children": ["Dashboard"] } },
      { "type": "Button", "props": { "text": "Save", "variant": "primary" } },
      { "type": "Button", "props": { "text": "Cancel", "variant": "secondary" } }
    ]
  }
}
```

- In **light mode**: Dark heading text, dark primary button, outlined secondary
- In **dark mode**: Light heading text, blue primary button, filled secondary

### Update Existing Wireframes

Use `update_wireframe` to modify existing wireframe content without recreating.

### Real Example: Multi-Page Flow

Example showing wireframe for a product ordering flow:

**Screen 1: Product List**
```json
{
  "type": "Container",
  "props": {
    "direction": "col",
    "gap": "medium",
    "children": [
      {
        "type": "Navigation",
        "props": {
          "items": [
            { "label": "Products", "active": true },
            { "label": "Cart" }
          ]
        }
      },
      {
        "type": "Container",
        "props": {
          "direction": "row",
          "gap": "large",
          "children": [
            {
              "type": "Card",
              "props": {
                "title": "Product A",
                "children": [
                  { "type": "Display", "props": { "type": "paragraph", "content": "$29.99" } },
                  { "type": "Button", "props": { "text": "Add to Cart", "variant": "primary" } }
                ]
              }
            },
            {
              "type": "Card",
              "props": {
                "title": "Product B",
                "children": [
                  { "type": "Display", "props": { "type": "paragraph", "content": "$39.99" } },
                  { "type": "Button", "props": { "text": "Add to Cart", "variant": "primary" } }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}
```

## Component Details

### Text Component

Display text with semantic meaning:

```json
{ "type": "Text", "props": { "variant": "heading", "children": ["Page Title"] } }
{ "type": "Text", "props": { "variant": "body", "children": ["Regular paragraph text"] } }
{ "type": "Text", "props": { "variant": "caption", "children": ["Small helper text"] } }
```

**Variants:**
- `heading` - Large, bold (h1/h2 equivalent)
- `body` - Regular paragraph text
- `caption` - Small, muted helper text

### Input Component

Text entry fields with validation feedback:

```json
{ "type": "Input", "props": { "placeholder": "Enter name", "label": "Full Name" } }
{ "type": "Input", "props": { "type": "email", "placeholder": "name@example.com", "label": "Email" } }
{ "type": "Input", "props": { "type": "password", "placeholder": "••••••••", "label": "Password" } }
{ "type": "Input", "props": { "type": "number", "placeholder": "0", "label": "Age" } }
```

**Props:**
- `label` - Displayed above input
- `placeholder` - Gray hint text
- `type` - text, email, password, number, search, url
- `required` - Boolean, shows required indicator
- `error` - Boolean, shows error styling

### Button Component

Interactive trigger elements:

```json
{ "type": "Button", "props": { "text": "Click Me", "variant": "primary" } }
{ "type": "Button", "props": { "text": "Secondary", "variant": "secondary" } }
{ "type": "Button", "props": { "text": "Danger", "variant": "danger" } }
{ "type": "Button", "props": { "text": "Disabled", "disabled": true } }
```

**Variants:**
- `primary` - Main action (solid, prominent)
- `secondary` - Alternative action (outlined)
- `danger` - Destructive action (red/warning colors)

### Container Component

Flexible layout wrapper:

```json
{
  "type": "Container",
  "props": {
    "direction": "col",
    "gap": "medium",
    "children": [ ... ]
  }
}
```

**Props:**
- `direction` - "row" (horizontal) or "col" (vertical)
- `gap` - "small", "medium", "large" (spacing between children)
- `padding` - "small", "medium", "large" (internal spacing)
- `children` - Array of components

### Card Component

Grouped content with optional title:

```json
{
  "type": "Card",
  "props": {
    "title": "Card Title",
    "variant": "elevated",
    "children": [ ... ]
  }
}
```

**Variants:**
- `default` - Subtle border only
- `elevated` - Shadow effect for depth
- `filled` - Subtle background

### Navigation Component

Header or sidebar navigation:

```json
{
  "type": "Navigation",
  "props": {
    "items": [
      { "label": "Home", "active": true },
      { "label": "About", "active": false },
      { "label": "Contact", "active": false }
    ],
    "variant": "horizontal"
  }
}
```

**Props:**
- `items` - Array of {label, active}
- `variant` - "horizontal" (top nav) or "vertical" (sidebar)

### Display Component

Read-only content display:

```json
{ "type": "Display", "props": { "type": "paragraph", "content": "Regular text content" } }
{ "type": "Display", "props": { "type": "list", "content": ["Item 1", "Item 2", "Item 3"] } }
{ "type": "Display", "props": { "type": "code", "content": "const x = 42;" } }
```

## Common Mistakes

### Mistake 1: Nesting Too Deeply
Don't create deeply nested structures - wireframes should feel simple and sketchy.

**Bad:**
```json
{
  "type": "Container",
  "props": {
    "children": [{
      "type": "Container",
      "props": {
        "children": [{
          "type": "Container",
          "props": {
            "children": [{ "type": "Text", "props": { "children": ["Text"] } }]
          }
        }]
      }
    }]
  }
}
```

**Good:**
```json
{
  "type": "Container",
  "props": {
    "direction": "col",
    "gap": "medium",
    "children": [
      { "type": "Text", "props": { "variant": "heading", "children": ["Title"] } },
      { "type": "Text", "props": { "variant": "body", "children": ["Content"] } }
    ]
  }
}
```

### Mistake 2: Over-Styling
Rough wireframes shouldn't include precise colors or custom styling - that's what final design tools are for.

**Bad:**
```json
{
  "type": "Text",
  "props": {
    "color": "#FF5733",
    "fontSize": "24px",
    "fontFamily": "Helvetica Neue",
    "children": ["Styled Text"]
  }
}
```

**Good:**
```json
{
  "type": "Text",
  "props": {
    "variant": "heading",
    "children": ["Page Title"]
  }
}
```

### Mistake 3: Mixing Concerns
Keep wireframes focused on layout and interaction, not content copy. Use placeholder text.

**Bad:**
```json
{
  "type": "Text",
  "props": {
    "children": ["Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua..."]
  }
}
```

**Good:**
```json
{
  "type": "Text",
  "props": {
    "variant": "body",
    "children": ["Product description placeholder - focus on layout"]
  }
}
```

### Mistake 4: Wrong Component Type
Use semantic components - don't try to create custom layouts.

**Bad:**
```json
{
  "type": "Container",
  "props": {
    "children": [
      { "type": "Display", "props": { "content": "← Home" } },
      { "type": "Display", "props": { "content": "About" } },
      { "type": "Display", "props": { "content": "Contact" } }
    ]
  }
}
```

**Good:**
```json
{
  "type": "Navigation",
  "props": {
    "items": [
      { "label": "Home", "active": true },
      { "label": "About" },
      { "label": "Contact" }
    ]
  }
}
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

## Syntax Validation

The system validates all wireframe JSON before rendering. Common errors:

- Missing `type` field
- Invalid component type
- Malformed `children` array
- Invalid `variant` or `direction` value

If validation fails, you'll see an error message with line number. Check the JSON structure against the component reference above.

## Advanced: Combining with Other Tools

### Link Wireframe in Design Document

In a markdown document, reference your wireframe:

```markdown
## Product List Screen

See the wireframe here: [wireframe-id]

### Design Notes
- Three-column grid for products
- Add to cart triggers modal
- Navigation stays fixed at top
```

### Show Multiple Screens

Create separate wireframes for each screen in a user flow, then link them in a flow diagram or document.

### Validate Before Creating

Before spending time on JSON, sketch the structure:

```
HomePage
├── Navigation [items: Home, Products, Cart]
└── Container [col]
    ├── Hero section
    ├── Featured products [row]
    │  ├── Card [Product 1]
    │  ├── Card [Product 2]
    │  └── Card [Product 3]
    └── Footer
```

Then convert to JSON components.

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
