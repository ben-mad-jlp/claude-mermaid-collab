# Feature Spec: Session Display Name Badge

## Problem
When viewing a session in the collab UI, the display name badge should show a human-readable name derived from the session state (e.g. "Vibe Active" instead of "vibe-active").

## Requirements
1. The GET /api/session-state endpoint must return a `displayName` field
2. The displayName should be computed from the `state` field by replacing hyphens with spaces and title-casing
3. If no state is set, fall back to the session name
4. The SessionCard component should render the displayName badge

## Out of Scope
- Custom user-defined display names
- Localization

## Success Criteria
- API returns displayName in session state response
- UI shows the badge correctly
- Works for all state values (vibe-active, collab-start, etc.)
