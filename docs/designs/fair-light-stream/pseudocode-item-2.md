# Pseudocode: Item 2 - Fix terminal close causing project change

### Header useEffect #1 (sync selectedProject with currentSession)

```
WHEN currentSession?.project OR selectedProject changes:

1. IF currentSession has a project AND it differs from selectedProject:
   - Update selectedProject to match currentSession.project

Note: Adding selectedProject to deps ensures fresh comparison,
      preventing stale closure from triggering unnecessary updates.
```

### Header useEffect #2 (auto-select first project)

```
WHEN projects OR selectedProject OR currentSession changes:

1. IF no selectedProject is set
   AND projects array is not empty
   AND no currentSession is active:
   - Set selectedProject to projects[0]

Note: Adding currentSession guard prevents auto-select from
      triggering when user already has an active session.
      This was causing the cascade during terminal operations.
```

**Error Handling:**
- No explicit error handling needed (pure state management)
- React handles dependency tracking

**Edge Cases:**
- currentSession becomes null: Don't auto-switch project if user manually selected one
- Multiple rapid terminal closes: Each triggers useEffect, but guards prevent cascade
- Project list empty: No auto-select occurs

**Dependencies:**
- React useEffect hooks
- sessionStore (currentSession)
- Local state (selectedProject)
