# Implementation: anchor-extraction

## Changes

### New exported functions in `src/mcp/tools/snippet.ts`

- **`findAnchorLine(lines, anchor, label, filePath)`** — Searches lines for a trimmed anchor string. Throws on 0 matches (with anchor + filePath) or 2+ matches (with line numbers and 1-line context around each). Returns the single matching line index.

- **`extractWithAnchors(fileContent, filePath, startAt?, endAt?, maxLines?)`** — Normalizes CRLF, splits into lines, resolves start/end indices via `findAnchorLine`, validates ordering and range size (default 500), returns the sliced lines joined by newline. Rejects single-line (minified) files when anchors are provided.

### Modified: `handleCreateSnippet`

- Added params: `startAt`, `endAt`, `maxLines`
- Anchor-based extraction (`extractWithAnchors`) takes priority over legacy `startLine`/`endLine`
- Deprecation warning logged via `console.warn` when `startLine`/`endLine` are used
- Stores `startAt`/`endAt` in the snippet JSON envelope

### Modified: `createSnippetSchema`

- Added `startAt`, `endAt`, `maxLines` properties with descriptions
- Marked `startLine`/`endLine` descriptions as deprecated

## Tests (17 passing)

`src/mcp/tools/__tests__/snippet-anchors.test.ts`:

- **findAnchorLine** (7 tests): 0 matches, 1 match, multiple matches, whitespace trimming (anchor + lines), empty anchor, label in errors
- **extractWithAnchors** (10 tests): whole file, startAt only, endAt only, both anchors, single line (same anchor), CRLF normalization, minified file rejection, endAt-before-startAt, maxLines exceeded, maxLines exact boundary
