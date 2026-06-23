# Wave 4 Implementation

## Tasks
- **session-registry-v2** (`session-registry.ts`): Added 'code-files' to resolvePath type union, guard condition, error message, and mkdir block in register().
- **migration-script** (`src/migrations/migrate-linked-snippets.ts` NEW): Idempotent migration — linked snippets → .codefile, filePath snippets → flat+tag, old envelopes → flat format. Backup + sentinel.
- **mcp-snippet-tools-v2** (`src/mcp/tools/snippet.ts`): Removed sourcePath/startAt/endAt/groupId/groupName from create_snippet; removed anchor helpers; added tags param to create_snippet and update_snippet.

## Verification
TypeScript check: zero errors.
