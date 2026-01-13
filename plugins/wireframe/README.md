# mermaid-wireframe

A Mermaid.js external diagram plugin for creating wireframe mockups and UI prototypes using simple text-based syntax. Perfect for rapid prototyping, documentation, and design discussions.

[![npm version](https://img.shields.io/npm/v/mermaid-wireframe.svg)](https://www.npmjs.com/package/mermaid-wireframe)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 📱 **Multi-viewport support**: Mobile (375px), Tablet (768px), Desktop (1200px)
- 🎨 **20+ UI components**: Buttons, Inputs, Cards, Grids, Navigation, Icons, and more
- 📐 **Flex layout engine**: Automatic responsive layouts with flex, width, height, padding
- 🎭 **Component variants**: Primary, secondary, danger, success button styles
- 🖼️ **Grid support**: Create data tables with headers and rows
- ⚡ **Fast rendering**: Built with d3.js for efficient SVG generation
- 🔧 **Extensible**: Clean architecture following Mermaid's plugin patterns

## Installation

```bash
npm install mermaid-wireframe mermaid
```

## Usage

### Node.js / Server-side

```javascript
import mermaid from 'mermaid';
import * as wireframe from 'mermaid-wireframe';

// Register the wireframe plugin
await mermaid.registerExternalDiagrams([wireframe]);

// Initialize mermaid
mermaid.initialize({ startOnLoad: true });

// Render a diagram
const { svg } = await mermaid.render('diagram-id', `
  wireframe mobile
    col
      AppBar "My App"
      Title "Welcome"
      Input "Email"
      Input "Password"
      Button "Sign In" primary
`);
```

### Browser

```html
<!DOCTYPE html>
<html>
<head>
  <script type="importmap">
  {
    "imports": {
      "d3": "https://cdn.jsdelivr.net/npm/d3@7/+esm"
    }
  }
  </script>
</head>
<body>
  <pre class="mermaid">
    wireframe mobile
      col
        AppBar "Sign In"
        Title "Welcome Back"
        Input "Email"
        Input "Password"
        Button "Sign In" primary
  </pre>

  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    import * as wireframe from './node_modules/mermaid-wireframe/dist/mermaid-wireframe.browser.js';

    await mermaid.registerExternalDiagrams([wireframe]);
    mermaid.initialize({ startOnLoad: true });
  </script>
</body>
</html>
```

## Syntax

### Basic Structure

```
wireframe [viewport] [direction]
  screen ["label"]
    [component] ["label"] [modifiers]
```

### Viewports

- `mobile` - 375×600px (default)
- `tablet` - 768×1024px
- `desktop` - 1200×800px

### Direction

- `LR` - Left to right (default, horizontal screen layout)
- `TD` - Top to down (vertical screen layout)

### Multi-Screen Layouts

Use `screen` to define multiple screens in one diagram:

```
wireframe mobile LR
  screen "Login"
    col
      AppBar "Sign In"
      Input "Email"
  screen "Dashboard"
    col
      AppBar "Home"
      Title "Welcome"
```

### Containers

- `screen ["label"]` - Screen container with optional label (rendered with dashed border)
- `col` - Vertical column (default direction)
- `row` - Horizontal row
- `Card` - Card container with border
- `Grid` - Data grid (use with `header` and `row`)

### Components

**Text & Titles:**
- `Text "content"` - Body text
- `Title "content"` - Large heading

**Form Inputs:**
- `Input "placeholder"` - Text input field
- `Checkbox "label"` - Checkbox
- `Radio "label"` - Radio button
- `Switch "label"` - Toggle switch
- `Dropdown "label"` - Dropdown/select

**Buttons:**
- `Button "label"` - Standard button
- Variants: `primary`, `secondary`, `danger`, `success`
- State: `disabled`

**Navigation:**
- `AppBar "title"` - Top app bar
- `NavMenu "item"` - Navigation menu item
- `BottomNav` - Bottom navigation bar
- `FAB` - Floating action button

**Display:**
- `Avatar` - User avatar circle
- `Icon` - Icon placeholder
- `Image` - Image placeholder
- `List "item"` - List item

**Layout:**
- `spacer` - Flexible spacing element
- `divider` - Horizontal line separator

### Modifiers

**Layout:**
- `flex` or `flex=2` - Flex grow factor
- `width=200` - Fixed width in pixels
- `height=100` - Fixed height in pixels
- `padding=16` - Internal padding
- `align=start|center|end|space-between` - Main axis alignment
- `cross=start|center|end` - Cross axis alignment

**Appearance:**
- `primary`, `secondary`, `danger`, `success` - Component variants
- `disabled` - Disabled state

## Examples

### Mobile Login Screen

```
wireframe mobile
  col
    AppBar "Sign In"
    col padding=24
      Title "Welcome Back"
      Text "Enter your credentials"
      Input "Email"
      Input "Password"
      Button "Sign In" primary
      Button "Forgot Password?" secondary
```

### Desktop Dashboard

```
wireframe desktop
  col
    AppBar "Dashboard"
    row padding=16
      col flex=2
        Card
          Title "User Stats"
          Text "Total Users: 1,234"
          Text "Active Today: 567"
      col flex=3
        Grid
          header "Name | Email | Status"
          row "John Doe | john@example.com | Active"
          row "Jane Smith | jane@example.com | Active"
```

### Mobile Profile

```
wireframe mobile
  col
    AppBar "Profile"
    col align=center padding=24
      Avatar
      Title "John Doe"
      Text "john.doe@example.com"
    divider
    List "Edit Profile"
    List "Settings"
    List "Privacy"
    spacer
    Button "Sign Out" danger
```

## Architecture

The plugin follows Mermaid's external diagram architecture with three main components:

- **Parser** (Jison): Parses wireframe DSL into node tree
- **Database**: Manages diagram state and tree building
- **Renderer** (d3.js): Renders nodes as SVG with flex layout

## Development

```bash
# Install dependencies
npm install

# Build the parser and bundle
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © ben-mad-jlp

## Acknowledgments

Built with [Mermaid.js](https://mermaid.js.org/) and [d3.js](https://d3js.org/).
