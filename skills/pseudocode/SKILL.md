---
name: pseudocode
description: Use when creating, updating, or reviewing .pseudo files for code files. Also use when the user says /pseudocode, asks to generate pseudocode, or asks to update pseudocode after code changes.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# Pseudocode Skill

Generate or update `.pseudo` files that summarize code files in plain English, following the project's PSEUDOCODE_SPEC.md.

## Step 1: Read the Spec

Look for `PSEUDOCODE_SPEC.md` in the project root first (allows per-project customization). If it doesn't exist there, read the bundled default from this skill's directory at `PSEUDOCODE_SPEC.md` (sibling to this SKILL.md). This is the authoritative format reference.

## Step 2: Determine Target Files

The user may specify:
- **A specific file**: `/pseudocode src/mcp/server.ts` — generate/update for that file
- **A directory**: `/pseudocode src/mcp/` — generate/update for all qualifying files in that directory
- **No argument**: generate/update for all files changed since the last commit (use `git diff --name-only HEAD`)
- **"all"**: `/pseudocode all` — backfill the entire codebase

For each candidate file, check the spec's skip rules:
- Skip index/barrel files (only re-exports)
- Skip pure type/interface definition files
- Skip test files
- Skip config files
- Skip files under 20 lines

## Step 3: For Each Target File

### If no `.pseudo` file exists — Generate

1. Read the code file completely.
2. Read the spec (if not already loaded).
3. Write the `.pseudo` file following the spec format:
   - Header: title and purpose
   - Module-level context (if applicable)
   - FUNCTION blocks for each named function/method/callback
   - `---` separators between blocks
   - `EXPORT` markers on public API
   - `CALLS:` lines for cross-file function references (check the code's imports to determine these)
4. Apply the 30-second rule: re-read the pseudocode and verify someone could understand the file's purpose quickly.

### If `.pseudo` file already exists — Update

1. Read both the code file and the existing `.pseudo` file.
2. Compare the logic. Ask: did any function's behavior change? Were functions added or removed?
3. If no logic changes, report "pseudocode is up to date" and skip.
4. If logic changed, update only the affected FUNCTION blocks. Preserve the rest.
5. If functions were added, add new FUNCTION blocks.
6. If functions were removed, remove their FUNCTION blocks.

## Step 4: Report

After processing, report:
- How many files were processed
- How many `.pseudo` files were created vs updated vs skipped

## Language-Specific Guidance

The pseudocode format is language-agnostic. Apply it to any language:

- **TypeScript/JavaScript**: Functions, exported functions, React component bodies, callbacks, hooks
- **Python**: Functions, methods, class definitions (one FUNCTION block per method)
- **Go**: Functions, methods (receiver functions get `FUNCTION (Type) methodName` format)
- **Rust**: Functions, impl methods, trait methods
- **Shell scripts**: Functions. For scripts without functions, describe the top-level flow as numbered steps under a single FUNCTION block named after the script.
- **SQL**: Stored procedures, complex queries (describe as FUNCTION blocks)

## Key Reminders

- **Code is the source of truth.** The pseudocode describes intent, not implementation.
- **Plain English over syntax.** "Parse the request body" not "JSON.parse(req.body)".
- **Specific where it matters.** Error codes, key field names, behavioral quirks. Vague everywhere else.
- **Every named function gets its own block.** Don't inline function logic into parent descriptions.
- **30-second rule.** If the pseudocode takes longer than 30 seconds to understand the file, it's too detailed.
- **CALLS annotation.** Add `CALLS: functionName (file-stem)` for cross-file dependencies. Derive from the code's imports. Omit stdlib/framework calls.
