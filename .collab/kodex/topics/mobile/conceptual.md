# Mobile Layout

The mobile layout provides a touch-optimized interface for viewports under 640px width, using tab-based navigation instead of the desktop's multi-panel approach.

## Navigation

Bottom tab bar with three tabs:
1. **Preview**: Diagram/document viewing with item selection
2. **Chat**: Claude interaction with AI UI cards
3. **Terminal**: xterm.js terminal with tab management

## Components

- **MobileHeader**: Compact header with session selector
- **ItemDrawer**: Slide-up bottom sheet for item selection
- **PreviewTab**: Full-screen preview with item drawer trigger
- **ChatTab**: Chat messages with inline AI UI cards
- **TerminalTab**: Full-screen terminal with xterm integration