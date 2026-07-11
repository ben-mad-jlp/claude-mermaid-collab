# Implementation: trim-ui-layer

## Files Changed
- ui/src/lib/api.ts
- ui/src/components/layout/Header.tsx
- ui/src/components/dashboard/index.ts

## What Was Implemented
- **api.ts**: Removed `sessionType?: 'structured' | 'vibe'` from both the `ApiClient` interface signature and the `createSession` implementation. Removed `sessionType` from the `JSON.stringify` body call. New signature: `createSession(project, session, useRenderUI?)`.
- **Header.tsx**: Removed `import { SessionStatusPanel } from '@/components/SessionStatusPanel'` (line 20) and removed the `<SessionStatusPanel variant="inline" />` render element from the logo/left section (line ~313).
- **dashboard/index.ts**: Removed the `WorkItemsList` export line (`export { WorkItemsList, type WorkItemsListProps } from './WorkItemsList'`) and updated the file comment block.

## Test Results
N/A

## Decisions / Assumptions
- No callers of `createSession` passed `sessionType` as their third arg (they used positional args or named); removing the parameter shifts `useRenderUI` from 4th to 3rd position — consistent with the blueprint spec.
- The dashboard index comment block still lists other exported components; the WorkItemsList entry in the JSDoc comment was also removed to keep the comment accurate.
