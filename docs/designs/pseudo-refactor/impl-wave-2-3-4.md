# Waves 2-4 Implementation

## Wave 2: pseudo-parser-server
- Created `src/services/pseudo-parser.ts` — server-side parser with fixed regex, exports ParsedPseudoFile/ParsedMethod/ParsedStep types + parsePseudo function

## Wave 3: pseudo-db-service
- Created `src/services/pseudo-db.ts` — SQLite service with 4 tables + FTS5, singleton pattern, 15 query methods (upsert, search, callGraph, impactAnalysis, orphans, stale, coverage, etc.)

## Wave 4: pseudo-api-update, pseudo-server-init, pseudo-mcp-tools
- Rewrote `src/routes/pseudo-api.ts` — replaced filesystem walks with PseudoDbService, added 9 new endpoints
- Updated `src/server.ts` — background pseudo DB ingest on startup
- Updated `src/mcp/setup.ts` — added 6 MCP tools (pseudo_impact_analysis, pseudo_find_function, pseudo_get_module_summary, pseudo_call_chain, pseudo_stale_check, pseudo_coverage_report)

## Verification
- TypeScript: no new errors across all changed files
- All legacy helpers (walkDir, findPseudoByBasename) removed
- All 6 MCP tools have definitions + handlers
- All 9 new API endpoints verified