# Task Dependency Graph

## YAML Task Graph

```yaml
tasks:
  # === Wave 1: No dependencies (all parallel) ===
  
  - id: use-is-mobile-hook
    files: [ui/src/hooks/useIsMobile.ts]
    tests: [ui/src/hooks/useIsMobile.test.ts, ui/src/hooks/__tests__/useIsMobile.test.ts]
    description: Mobile detection hook using matchMedia (< 640px)
    parallel: true

  - id: bottom-tab-bar
    files: [ui/src/components/layout/BottomTabBar.tsx]
    tests: [ui/src/components/layout/BottomTabBar.test.tsx, ui/src/components/layout/__tests__/BottomTabBar.test.tsx]
    description: Bottom navigation tab bar with Preview/Chat/Terminal tabs
    parallel: true

  - id: mobile-header
    files: [ui/src/components/layout/MobileHeader.tsx]
    tests: [ui/src/components/layout/MobileHeader.test.tsx, ui/src/components/layout/__tests__/MobileHeader.test.tsx]
    description: Compact mobile header with project/session dropdowns
    parallel: true

  - id: item-drawer
    files: [ui/src/components/mobile/ItemDrawer.tsx]
    tests: [ui/src/components/mobile/ItemDrawer.test.tsx, ui/src/components/mobile/__tests__/ItemDrawer.test.tsx]
    description: Slide-up bottom sheet for item selection
    parallel: true

  - id: chat-tab
    files: [ui/src/components/mobile/ChatTab.tsx]
    tests: [ui/src/components/mobile/ChatTab.test.tsx, ui/src/components/mobile/__tests__/ChatTab.test.tsx]
    description: Full-screen chat wrapper with AI UI auto-switch
    parallel: true

  - id: terminal-tab
    files: [ui/src/components/mobile/TerminalTab.tsx]
    tests: [ui/src/components/mobile/TerminalTab.test.tsx, ui/src/components/mobile/__tests__/TerminalTab.test.tsx]
    description: Full-screen terminal wrapper
    parallel: true

  # === Wave 2: Depends on Wave 1 ===
  
  - id: preview-tab
    files: [ui/src/components/mobile/PreviewTab.tsx]
    tests: [ui/src/components/mobile/PreviewTab.test.tsx, ui/src/components/mobile/__tests__/PreviewTab.test.tsx]
    description: Full-screen preview with item drawer integration
    depends-on: [item-drawer]

  - id: mobile-layout
    files: [ui/src/components/layout/MobileLayout.tsx]
    tests: [ui/src/components/layout/MobileLayout.test.tsx, ui/src/components/layout/__tests__/MobileLayout.test.tsx]
    description: Root mobile layout container with tab switching
    depends-on: [mobile-header, bottom-tab-bar, preview-tab, chat-tab, terminal-tab]

  # === Wave 3: Integration ===
  
  - id: app-mobile-integration
    files: [ui/src/App.tsx]
    tests: []
    description: Integrate useIsMobile and MobileLayout into App.tsx
    depends-on: [use-is-mobile-hook, mobile-layout]
```

## Execution Waves

**Wave 1 (no dependencies - all parallel):**
- `use-is-mobile-hook` - Mobile detection hook
- `bottom-tab-bar` - Tab bar component
- `mobile-header` - Header component
- `item-drawer` - Item selection drawer
- `chat-tab` - Chat tab wrapper
- `terminal-tab` - Terminal tab wrapper

**Wave 2 (depends on Wave 1):**
- `preview-tab` - Depends on item-drawer
- `mobile-layout` - Depends on header, tab bar, and all tab components

**Wave 3 (depends on Wave 2):**
- `app-mobile-integration` - Depends on hook and layout

## File Conflict Analysis

**No conflicts detected.** Each task modifies unique files:

| Task | File |
|------|------|
| use-is-mobile-hook | ui/src/hooks/useIsMobile.ts |
| bottom-tab-bar | ui/src/components/layout/BottomTabBar.tsx |
| mobile-header | ui/src/components/layout/MobileHeader.tsx |
| item-drawer | ui/src/components/mobile/ItemDrawer.tsx |
| chat-tab | ui/src/components/mobile/ChatTab.tsx |
| terminal-tab | ui/src/components/mobile/TerminalTab.tsx |
| preview-tab | ui/src/components/mobile/PreviewTab.tsx |
| mobile-layout | ui/src/components/layout/MobileLayout.tsx |
| app-mobile-integration | ui/src/App.tsx (modification) |

## Dependency Diagram

See `task-dependency-graph` diagram in session.

## Summary

- **Total tasks:** 9
- **Total waves:** 3
- **Max parallelism:** 6 (Wave 1)
- **New files:** 8
- **Modified files:** 1 (App.tsx)