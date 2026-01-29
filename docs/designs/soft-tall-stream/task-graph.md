# Task Dependency Graph

## YAML Task Graph

```yaml
tasks:
  - id: session-status-panel-variant
    files: [ui/src/components/SessionStatusPanel.tsx]
    tests: [ui/src/components/SessionStatusPanel.test.tsx, ui/src/components/__tests__/SessionStatusPanel.test.tsx]
    description: Add variant prop to SessionStatusPanel with inline rendering mode
    parallel: true

  - id: sidebar-removal
    files: [ui/src/components/layout/Sidebar.tsx]
    tests: [ui/src/components/layout/Sidebar.test.tsx, ui/src/components/layout/__tests__/Sidebar.test.tsx]
    description: Remove SessionStatusPanel import and usage from Sidebar
    parallel: true

  - id: header-integration
    files: [ui/src/components/layout/Header.tsx]
    tests: [ui/src/components/layout/Header.test.tsx, ui/src/components/layout/__tests__/Header.test.tsx]
    description: Import and render SessionStatusPanel with variant="inline" after connection badge
    depends-on: [session-status-panel-variant]
```

## Execution Waves

**Wave 1 (no dependencies):**
- `session-status-panel-variant` - Add variant prop to SessionStatusPanel
- `sidebar-removal` - Remove SessionStatusPanel from Sidebar

**Wave 2 (depends on Wave 1):**
- `header-integration` - Import SessionStatusPanel into Header (requires variant prop)

## File Conflict Analysis

No file conflicts detected. Each task modifies a different file:
- `SessionStatusPanel.tsx` - Modified by session-status-panel-variant
- `Sidebar.tsx` - Modified by sidebar-removal
- `Header.tsx` - Modified by header-integration

## Dependency Analysis

| Task | Depends On | Reason |
|------|------------|--------|
| session-status-panel-variant | (none) | Core component change, no external deps |
| sidebar-removal | (none) | Removal only, no dependency on new variant |
| header-integration | session-status-panel-variant | Header imports SessionStatusPanel with variant prop |

## Summary

- **Total tasks:** 3
- **Total waves:** 2
- **Max parallelism:** 2 (Wave 1)
- **Critical path:** session-status-panel-variant → header-integration
