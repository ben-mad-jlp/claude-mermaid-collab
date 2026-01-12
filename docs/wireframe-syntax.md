# Wireframe Diagram Syntax Guide

The mermaid-wireframe plugin enables creating UI wireframe mockups using text-based syntax.

## Basic Structure

```
wireframe [viewport]
  [container]
    [component] ["label"] [modifiers]
```

## Viewports

Specify the target device size:
- `wireframe mobile` - 375×600px (smartphone, default if omitted)
- `wireframe tablet` - 768×1024px (tablet)
- `wireframe desktop` - 1200×800px (desktop/laptop)

## Containers

Containers organize child components:

- `col` - Vertical column (default direction, stacks children vertically)
- `row` - Horizontal row (places children side-by-side)
- `Card` - Card container with border and subtle background
- `Grid` - Data grid (special syntax with `header` and `row` children)

**Important:** Children must be indented (2 spaces) under their parent container.

## Components

### Text & Titles
- `Text "content"` - Body text
- `Title "content"` - Large heading

### Form Inputs
- `Input "placeholder"` - Text input field
- `Checkbox "label"` - Checkbox with label
- `Radio "label"` - Radio button with label
- `Switch "label"` - Toggle switch with label
- `Dropdown "label"` - Dropdown/select menu

### Buttons
- `Button "label"` - Standard button
- Add variants: `Button "label" primary|secondary|danger|success`
- Add state: `Button "label" disabled`

### Navigation
- `AppBar "title"` - Top application bar (typically first in layout)
- `NavMenu "item"` - Navigation menu item
- `BottomNav` - Bottom navigation bar (mobile pattern)
- `FAB` - Floating action button

### Display Elements
- `Avatar` - User avatar circle
- `Icon` - Icon placeholder square
- `Image` - Image placeholder rectangle
- `List "item"` - List item with text

### Layout Utilities
- `spacer` - Flexible spacing element (grows to fill available space)
- `divider` - Horizontal line separator

## Modifiers

Modifiers customize appearance and layout. Add them after the component label.

### Layout Modifiers
- `flex` or `flex=2` - Flex grow factor (makes component take proportional space)
- `width=200` - Fixed width in pixels
- `height=100` - Fixed height in pixels
- `padding=16` - Internal padding in pixels
- `align=start|center|end|space-between` - Main axis alignment
- `cross=start|center|end` - Cross axis alignment

### Appearance Modifiers
- `primary` - Primary button variant (dark background)
- `secondary` - Secondary button variant (light background)
- `danger` - Danger/destructive variant (red)
- `success` - Success variant (green)
- `disabled` - Disabled state (reduced opacity)

## Grid Syntax

Grids use special child syntax with `header` and `row` keywords:

```
wireframe desktop
  Grid
    header "Column 1 | Column 2 | Column 3"
    row "Data 1 | Data 2 | Data 3"
    row "Data 4 | Data 5 | Data 6"
```

Use pipe `|` to separate columns in headers and rows.

## Complete Examples

### Mobile Login Form
```
wireframe mobile
  col
    AppBar "Sign In"
    col padding=24
      Title "Welcome Back"
      Text "Enter your credentials"
      Input "Email"
      Input "Password"
      row
        Button "Forgot?" secondary
        spacer
        Button "Sign In" primary
```

### Desktop Dashboard with Grid
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

### Mobile Profile Screen
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

### Tablet Settings Form
```
wireframe tablet
  col
    AppBar "Settings"
    col padding=24
      Card
        Title "Account Settings"
        row
          Text "Email Notifications"
          spacer
          Switch "enabled"
        row
          Text "Push Notifications"
          spacer
          Switch "enabled"
        divider
        Button "Save Changes" primary
```

## Layout Tips

1. **Use flex for responsive layouts**: `col flex=2` takes twice the space of `col flex=1`
2. **Use spacer to push elements apart**: Great for separating buttons or creating footer spacing
3. **Nest containers for complex layouts**: `row` inside `col` or vice versa
4. **Use padding on containers**: `col padding=24` gives breathing room to content
5. **Keep it simple**: Wireframes should be low-fidelity - don't over-specify

## Common Patterns

### Form with Footer Buttons
```
col
  Title "Form Title"
  Input "Field 1"
  Input "Field 2"
  spacer
  row
    Button "Cancel" secondary
    spacer
    Button "Submit" primary
```

### Card List
```
col
  Card
    Title "Item 1"
    Text "Description"
  Card
    Title "Item 2"
    Text "Description"
```

### Navigation with Content
```
col
  AppBar "App Name"
  row flex
    col width=200
      List "Home"
      List "Settings"
      List "Profile"
    col flex
      Title "Main Content"
      Text "Content goes here"
```
