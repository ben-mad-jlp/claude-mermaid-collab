# Skeleton: Item 2 - Fix terminal close causing project change

## Planned Files
- [ ] `ui/src/components/layout/Header.tsx` - Modify existing (useEffect hooks)

**Note:** This is a modification to an existing file, not a new file.

## File Changes

### ui/src/components/layout/Header.tsx (MODIFY)

```typescript
// FIX 1: Update useEffect at lines 96-100
// Add selectedProject to dependency array

useEffect(() => {
  if (currentSession?.project && currentSession.project !== selectedProject) {
    setSelectedProject(currentSession.project);
  }
}, [currentSession?.project, selectedProject]); // TODO: Add selectedProject dependency

// FIX 2: Update useEffect at lines 103-107  
// Add currentSession guard and dependency

useEffect(() => {
  // TODO: Add currentSession guard to prevent auto-select during active session
  if (!selectedProject && projects.length > 0 && !currentSession) {
    setSelectedProject(projects[0]);
  }
}, [projects, selectedProject, currentSession]); // TODO: Add currentSession dependency
```

## Task Dependency Graph

```yaml
tasks:
  - id: item-2-header-fix
    files: [ui/src/components/layout/Header.tsx]
    tests: [ui/src/components/layout/Header.test.tsx, ui/src/components/layout/__tests__/Header.test.tsx]
    description: Fix useEffect dependencies to prevent state sync issues on terminal close
    parallel: true
```

## Execution Order

**Wave 1 (parallel-safe):**
- item-2-header-fix

## Verification
- [ ] First useEffect has selectedProject in deps array
- [ ] Second useEffect has currentSession guard
- [ ] Second useEffect has currentSession in deps array
