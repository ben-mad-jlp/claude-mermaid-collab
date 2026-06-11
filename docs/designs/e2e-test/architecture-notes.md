# Architecture Notes

## Display Name Flow

```
GET /api/session-state
  → read collab-state.json from disk
  → compute displayName from state field (if not already set)
  → return JSON with displayName included
```

## Key Files
- `src/routes/api.ts` — endpoint handler
- `src/mcp/tools/collab-state.ts` — CollabState interface, getSessionState()
- `ui/src/components/dashboard/SessionCard.tsx` — renders the badge

## Design Decision
displayName is computed at read-time, never persisted to disk. This avoids stale values when state changes.
