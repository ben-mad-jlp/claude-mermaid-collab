# Interface: Item 2 - Fix terminal close causing project change

## File Structure
- `ui/src/components/layout/Header.tsx` - Fix useEffect dependencies

## Type Definitions
No new types needed.

## Function Signatures
No new functions - fixing existing React hooks.

## Changes Required

```typescript
// ui/src/components/layout/Header.tsx

// FIX 1: Add missing dependency (line 96-100)
useEffect(() => {
  if (currentSession?.project && currentSession.project !== selectedProject) {
    setSelectedProject(currentSession.project);
  }
}, [currentSession?.project, selectedProject]); // ADD selectedProject

// FIX 2: Guard auto-select logic (line 103-107)
useEffect(() => {
  if (!selectedProject && projects.length > 0 && !currentSession) { // ADD currentSession guard
    setSelectedProject(projects[0]);
  }
}, [projects, selectedProject, currentSession]); // ADD currentSession
```

## Component Interactions
- Header useEffects sync `selectedProject` state with `currentSession` from store
- Fix prevents stale closures that cause cascade: Header → sessionStore → TerminalTabsContainer
