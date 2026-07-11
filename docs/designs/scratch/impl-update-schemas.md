# impl-update-schemas

## Changes

### snippet.ts — createSnippetSchema
- Removed `startLine` and `endLine` from schema properties (deprecated line-number params no longer advertised to Claude)
- Updated `startAt`, `endAt`, `maxLines` descriptions to match blueprint wording
- Handler still accepts startLine/endLine for backwards compat

### setup.ts — create_snippet / add_design_snippet handler
- Added `startAt`, `endAt`, `maxLines` to destructured args and type annotation
- Passes all three new params through to `handleCreateSnippet()`
- Kept `startLine`/`endLine` in destructuring for backwards compat (handler logs deprecation warning)
