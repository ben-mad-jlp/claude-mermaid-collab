# Implementation: update-api-endpoint

## Files Verified
- `src/routes/api.ts` (lines 331-363)

## What Was Found
The GET `/api/session-state` endpoint already implements displayName computation:
1. Reads `collab-state.json` from the session directory (with backwards-compatible path fallback)
2. Parses the JSON state
3. Computes `displayName` from the `state` field when not already set (line 355-357):
   - Replaces hyphens with spaces via `state.replace(/-/g, ' ')`
   - Title-cases each word via `.replace(/\b\w/g, c => c.toUpperCase())`
4. Returns the full state object (with computed displayName) as JSON
5. displayName is never persisted — computed at read-time only

## Verdict
Matches blueprint. Implementation is complete and correct.