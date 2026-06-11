# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 10
- **Total waves:** 3
- **Max parallelism:** 4

## Execution Waves

**Wave 1:** db-overhaul-v2, source-scanner-lib, gitignore-and-pseudo-cleanup
**Wave 2:** db-tests-rewrite, pseudo-api-update, mcp-tools-update, bin-structural-index-clis
**Wave 3:** delete-pseudo-parser, pre-commit-hook, skill-rewrite

## Task Graph (YAML)

```yaml
tasks:
  - id: db-overhaul-v2
    files: []
    description: "Rewrite pseudo-db.ts for schema v2. Change files.file_path to store source path. Rename synced_at → prose_updated_at. Add structural_indexed_at, has_prose columns. Add upsertStructural / upsertProse / deleteStructural / getFileState / checkpointWal methods. Delete upsertFile / bulkIngest / resolveSourceFilePath. Update every existing query method (getFile, getCallGraph, getSourceLink, getFunctionsForSource, etc.) for the new column layout. Update migration block to drop all tables on v1→v2 and recreate. Keep CALLS resolution logic (callee_file_stem joins file_stem derived from source basenames)."
    parallel: true
    depends-on: []
  - id: source-scanner-lib
    files: []
    description: "New module exporting scanSourceFile(absPath) and StructuralMethod / ScanResult types. Dispatches per language: TypeScript/JavaScript (primary, class + arrow + function decl + function expr), C#, C++, Python (good-effort). Duplicates the Phase 4 findMatchingBraceLineIndex brace walker. Computes sourceHash. Walks a class-context stack for owningSymbol. 20+ unit tests covering language branches, edge cases, malformed input."
    parallel: true
    depends-on: []
  - id: gitignore-and-pseudo-cleanup
    files: []
    tests: []
    description: "Update .gitignore: remove blanket /.collab/, add /.collab/sessions/ + /.collab/pseudo/pseudo.db-wal + /.collab/pseudo/pseudo.db-shm + !/.collab/pseudo/pseudo.db. Add *.pseudo blanket ignore. Delete every .pseudo file in the repo (100+ files under src/ and ui/). Delete scripts/pseudo-track-commit.pseudo and scripts/pseudo-hook-check.pseudo. This is mostly file deletion — bulk via Glob + Bash git rm."
    parallel: true
    depends-on: []
  - id: db-tests-rewrite
    files: []
    description: "Rewrite pseudo-db tests to use the new methods. Remove parsePseudo and ParsedPseudoFile references. Seed via upsertStructural + upsertProse instead of upsertFile. Verify column layout changes (file_path stores source path, prose_updated_at column, etc.). Add new tests for upsertStructural (insert, update, delete-method, preserve-prose), upsertProse (insert, update, match-by-name-and-params), getFileState, checkpointWal."
    parallel: true
    depends-on: [db-overhaul-v2]
  - id: pseudo-api-update
    files: []
    description: "Update pseudo-api.ts if any route referenced removed methods. Update pseudo-api.test.ts to seed via upsertStructural + upsertProse instead of the old upsertFile path. All existing endpoints (/stats, /files, /file, /graph, /impact, /coverage, /source-link, /functions-for-source, /references, /search) continue to work with schema v2."
    parallel: true
    depends-on: [db-overhaul-v2]
  - id: mcp-tools-update
    files: []
    tests: []
    description: "Add new MCP tools pseudo_index_structural, pseudo_index_project, pseudo_upsert_prose, pseudo_get_file_state. Delete any old tools that referenced upsertFile / bulkIngest (likely none — those were internal). Keep all existing read-only pseudo_* tools."
    parallel: true
    depends-on: [db-overhaul-v2]
  - id: bin-structural-index-clis
    files: []
    tests: []
    description: "New bin/structural-index.ts (pre-commit CLI reading staged files from git) and bin/structural-index-project.ts (full-project walker). Both use source-scanner + db.upsertStructural + db.checkpointWal. structural-index.ts also runs git add for the db file. Both exit 0 on scanner errors, log to .collab/pseudo/structural-index.log."
    parallel: true
    depends-on: [db-overhaul-v2, source-scanner-lib]
  - id: delete-pseudo-parser
    files: []
    tests: []
    description: "Delete pseudo-parser.ts and its test file. Remove any remaining imports of ParsedPseudoFile / ParsedMethod / ParsedStep / parsePseudo across the codebase. At this point (after Wave 2), none of the modified files should still reference these — this task just deletes them and verifies via Grep."
    parallel: false
    depends-on: [db-overhaul-v2, db-tests-rewrite, pseudo-api-update, mcp-tools-update]
  - id: pre-commit-hook
    files: []
    tests: []
    description: "Create new scripts/pre-commit that calls bin/structural-index.ts. Delete scripts/post-commit, scripts/pseudo-track-commit.sh, scripts/pseudo-hook-check.sh. Update the scripts/pseudo-* .pseudo siblings (delete them). Add install instructions to skills/pseudocode/SKILL.md (or a README) for how to symlink into .git/hooks/pre-commit."
    parallel: true
    depends-on: [bin-structural-index-clis]
  - id: skill-rewrite
    files: []
    tests: []
    description: "Rewrite skills/pseudocode/SKILL.md to ~30 lines around direct MCP tool calls (pseudo_get_file_state + pseudo_upsert_prose). Delete skills/pseudocode/PSEUDOCODE_SPEC.md. Delete PSEUDOCODE_SPEC.md (project root). Remove all references to .pseudo files, format markers, install mode, sync mode, .pseudo-needs-update, .pseudo-sync."
    parallel: true
    depends-on: [mcp-tools-update]
```

## Dependency Visualization

```mermaid
graph TD
    db-overhaul-v2["db-overhaul-v2<br/>"Rewrite pseudo-db.ts for sche..."]
    source-scanner-lib["source-scanner-lib<br/>"New module exporting scanSour..."]
    gitignore-and-pseudo-cleanup["gitignore-and-pseudo-cleanup<br/>"Update .gitignore: remove bla..."]
    db-tests-rewrite["db-tests-rewrite<br/>"Rewrite pseudo-db tests to us..."]
    pseudo-api-update["pseudo-api-update<br/>"Update pseudo-api.ts if any r..."]
    mcp-tools-update["mcp-tools-update<br/>"Add new MCP tools pseudo_inde..."]
    bin-structural-index-clis["bin-structural-index-clis<br/>"New bin/structural-index.ts (..."]
    delete-pseudo-parser["delete-pseudo-parser<br/>"Delete pseudo-parser.ts and i..."]
    pre-commit-hook["pre-commit-hook<br/>"Create new scripts/pre-commit..."]
    skill-rewrite["skill-rewrite<br/>"Rewrite skills/pseudocode/SKI..."]

     --> db-overhaul-v2
     --> source-scanner-lib
     --> gitignore-and-pseudo-cleanup
    db-overhaul-v2 --> db-tests-rewrite
    db-overhaul-v2 --> pseudo-api-update
    db-overhaul-v2 --> mcp-tools-update
    db-overhaul-v2 --> bin-structural-index-clis
    source-scanner-lib --> bin-structural-index-clis
    db-overhaul-v2 --> delete-pseudo-parser
    db-tests-rewrite --> delete-pseudo-parser
    pseudo-api-update --> delete-pseudo-parser
    mcp-tools-update --> delete-pseudo-parser
    bin-structural-index-clis --> pre-commit-hook
    mcp-tools-update --> skill-rewrite

    style db-overhaul-v2 fill:#c8e6c9
    style source-scanner-lib fill:#c8e6c9
    style gitignore-and-pseudo-cleanup fill:#c8e6c9
    style db-tests-rewrite fill:#bbdefb
    style pseudo-api-update fill:#bbdefb
    style mcp-tools-update fill:#bbdefb
    style bin-structural-index-clis fill:#bbdefb
    style delete-pseudo-parser fill:#fff3e0
    style pre-commit-hook fill:#fff3e0
    style skill-rewrite fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **db-overhaul-v2**: "Rewrite pseudo-db.ts for schema v2. Change files.file_path to store source path. Rename synced_at → prose_updated_at. Add structural_indexed_at, has_prose columns. Add upsertStructural / upsertProse / deleteStructural / getFileState / checkpointWal methods. Delete upsertFile / bulkIngest / resolveSourceFilePath. Update every existing query method (getFile, getCallGraph, getSourceLink, getFunctionsForSource, etc.) for the new column layout. Update migration block to drop all tables on v1→v2 and recreate. Keep CALLS resolution logic (callee_file_stem joins file_stem derived from source basenames)."
- **source-scanner-lib**: "New module exporting scanSourceFile(absPath) and StructuralMethod / ScanResult types. Dispatches per language: TypeScript/JavaScript (primary, class + arrow + function decl + function expr), C#, C++, Python (good-effort). Duplicates the Phase 4 findMatchingBraceLineIndex brace walker. Computes sourceHash. Walks a class-context stack for owningSymbol. 20+ unit tests covering language branches, edge cases, malformed input."
- **gitignore-and-pseudo-cleanup**: "Update .gitignore: remove blanket /.collab/, add /.collab/sessions/ + /.collab/pseudo/pseudo.db-wal + /.collab/pseudo/pseudo.db-shm + !/.collab/pseudo/pseudo.db. Add *.pseudo blanket ignore. Delete every .pseudo file in the repo (100+ files under src/ and ui/). Delete scripts/pseudo-track-commit.pseudo and scripts/pseudo-hook-check.pseudo. This is mostly file deletion — bulk via Glob + Bash git rm."

### Wave 2

- **db-tests-rewrite**: "Rewrite pseudo-db tests to use the new methods. Remove parsePseudo and ParsedPseudoFile references. Seed via upsertStructural + upsertProse instead of upsertFile. Verify column layout changes (file_path stores source path, prose_updated_at column, etc.). Add new tests for upsertStructural (insert, update, delete-method, preserve-prose), upsertProse (insert, update, match-by-name-and-params), getFileState, checkpointWal."
- **pseudo-api-update**: "Update pseudo-api.ts if any route referenced removed methods. Update pseudo-api.test.ts to seed via upsertStructural + upsertProse instead of the old upsertFile path. All existing endpoints (/stats, /files, /file, /graph, /impact, /coverage, /source-link, /functions-for-source, /references, /search) continue to work with schema v2."
- **mcp-tools-update**: "Add new MCP tools pseudo_index_structural, pseudo_index_project, pseudo_upsert_prose, pseudo_get_file_state. Delete any old tools that referenced upsertFile / bulkIngest (likely none — those were internal). Keep all existing read-only pseudo_* tools."
- **bin-structural-index-clis**: "New bin/structural-index.ts (pre-commit CLI reading staged files from git) and bin/structural-index-project.ts (full-project walker). Both use source-scanner + db.upsertStructural + db.checkpointWal. structural-index.ts also runs git add for the db file. Both exit 0 on scanner errors, log to .collab/pseudo/structural-index.log."

### Wave 3

- **delete-pseudo-parser**: "Delete pseudo-parser.ts and its test file. Remove any remaining imports of ParsedPseudoFile / ParsedMethod / ParsedStep / parsePseudo across the codebase. At this point (after Wave 2), none of the modified files should still reference these — this task just deletes them and verifies via Grep."
- **pre-commit-hook**: "Create new scripts/pre-commit that calls bin/structural-index.ts. Delete scripts/post-commit, scripts/pseudo-track-commit.sh, scripts/pseudo-hook-check.sh. Update the scripts/pseudo-* .pseudo siblings (delete them). Add install instructions to skills/pseudocode/SKILL.md (or a README) for how to symlink into .git/hooks/pre-commit."
- **skill-rewrite**: "Rewrite skills/pseudocode/SKILL.md to ~30 lines around direct MCP tool calls (pseudo_get_file_state + pseudo_upsert_prose). Delete skills/pseudocode/PSEUDOCODE_SPEC.md. Delete PSEUDOCODE_SPEC.md (project root). Remove all references to .pseudo files, format markers, install mode, sync mode, .pseudo-needs-update, .pseudo-sync."
