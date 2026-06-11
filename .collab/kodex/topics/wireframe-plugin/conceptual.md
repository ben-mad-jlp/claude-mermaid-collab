# Wireframe Diagram Plugin

A Mermaid.js external diagram plugin for creating wireframe mockups and UI prototypes using text-based syntax. Published as `mermaid-wireframe` on npm.

## Features

- **Multi-viewport**: Mobile (375px), Tablet (768px), Desktop (1200px)
- **20+ UI Components**: Buttons, Inputs, Cards, Grids, Navigation, Icons
- **Flex Layout Engine**: Automatic responsive layouts
- **Component Variants**: Primary, secondary, danger, success styles
- **Grid Support**: Data tables with headers and rows
- **Fast Rendering**: Built with d3.js for SVG generation

## Basic Syntax

```mermaid
wireframe mobile
  col
    AppBar "My App"
    Title "Welcome"
    Input "Email"
    Input "Password"
    Button "Sign In" primary
```