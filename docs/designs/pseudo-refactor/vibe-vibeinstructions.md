# Vibe: pseudo-refactor

## Goal
Remove Kodex, refactor Pseudo from file-based .pseudo files to SQLite DB, rewire Onboarding to Pseudo.

## Context
- Kodex removed entirely — committed v5.53.0
- Pseudo now backed by SQLite with FTS5 (files, methods, method_steps, method_calls tables)
- Onboarding redesigned: 3-tab model, directory-based grouping
- 6 new MCP tools, 9 new API endpoints
- Background file ingest removed — DB is source of truth
- 258 files already migrated into DB

## Currently Doing
- Blueprint created: bp-pseudo-ui-migration — 17 tasks across 6 waves
- Task graph synced and ready
- Next step: run /vibe-go to execute
- Goal: Update pseudo UI to consume structured DB responses instead of raw .pseudo text
- Key changes: remove parsePseudo.ts, update all components to use PseudoMethod/PseudoFileWithMethods types