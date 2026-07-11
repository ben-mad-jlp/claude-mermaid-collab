# Implementation: deprecate-patch-snippet

## Changes in `src/mcp/setup.ts`

1. **Tool description** (line 2042): Prepended `[DEPRECATED — use update_snippet with full content instead]` to the patch_snippet tool description so LLM consumers see the deprecation notice in the tool listing.

2. **Handler case** (line 3673): Added `console.warn('[DEPRECATED] patch_snippet is deprecated. Use update_snippet with full content replacement instead.');` before the existing logic so runtime invocations produce a visible deprecation warning in server logs.

No behavioral changes — the tool still functions as before but is now clearly marked as deprecated.