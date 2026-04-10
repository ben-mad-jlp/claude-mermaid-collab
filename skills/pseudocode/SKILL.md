---
name: pseudocode
description: Use when creating, updating, or reviewing pseudocode for source code files. The pseudocode is stored in the pseudo-db (SQLite) and rendered in the collab UI.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, mcp__mermaid__pseudo_get_file_state, mcp__mermaid__pseudo_upsert_prose
---

# Pseudocode Skill

Generate or update plain-English descriptions of what source code files do. Results are written directly to the pseudo-db via MCP tools. There are no `.pseudo` files on disk — everything lives in SQLite.

## Usage

- `/pseudocode <file-path>` — process a single file
- `/pseudocode <directory>` — process all qualifying files in a directory
- `/pseudocode` (no args) — process files changed since the last commit (`git diff --name-only HEAD`)

## Step 1 — Determine target files

Skip:
- Index/barrel files
- Pure type definition files
- Test files
- Files under 20 lines

## Step 2 — For each target file

1. Read the source code file from disk.
2. Call `mcp__mermaid__pseudo_get_file_state(project, filePath)` to see what's already in the db.
3. Decide which methods need regenerating:
   - All methods if `proseUpdatedAt` is null or `hasProse` is false
   - Methods whose `hasSteps` is false
   - All methods if the file's source hash changed since the last prose update (compare against `getFileState`'s source hash; regenerate all on mismatch)
4. Generate prose for each target method:
   - **Title**: one-line summary of the file
   - **Purpose**: 1-2 sentence description
   - **Module context**: prose between file header and first function (if applicable)
   - **For each method**: a list of numbered steps in plain English (the pseudocode), plus CALLS references for cross-file function invocations
5. Call `mcp__mermaid__pseudo_upsert_prose(project, filePath, data)` where `data` is the ProseData shape:
   ```
   { title?, purpose?, moduleContext?, methods: [{ name, params?, steps: [{ content, depth }], calls: [{ name, fileStem }] }] }
   ```

## Pseudocode Style

Plain English, numbered steps. Use IF/ELSE for branching. Follow the 30-second rule: a reader should grasp the function's purpose in under 30 seconds. Describe intent, not implementation. No format markers — there is no file format.

## Report

After processing, report how many files were processed and how many methods had their prose regenerated.
