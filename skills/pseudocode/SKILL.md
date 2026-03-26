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
- **"sync"**: `/pseudocode sync` — process the `.pseudo-needs-update` manifest (see Sync section)
- **"install"**: `/pseudocode install` — set up commit tracking in this project (see Install section)

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
3. Get the current UTC date: `date -u +%Y-%m-%dT%H:%M:%SZ`
4. Write the `.pseudo` file following the spec format:
   - Header: title, purpose, then `// synced: <timestamp>`
   - Module-level context (if applicable)
   - FUNCTION blocks with `[YYYY-MM-DD]` date suffix on each FUNCTION line
   - `---` separators between blocks
   - `EXPORT` markers on public API
   - `CALLS:` lines for cross-file function references (check the code's imports to determine these)
5. Apply the 30-second rule: re-read the pseudocode and verify someone could understand the file's purpose quickly.

### If `.pseudo` file already exists — Update

1. Read both the code file and the existing `.pseudo` file.
2. Get the current UTC date: `date -u +%Y-%m-%dT%H:%M:%SZ`
3. Compare the logic. Ask: did any function's behavior change? Were functions added or removed?
4. If no logic changes, report "pseudocode is up to date" and skip. Do not touch the timestamps.
5. If logic changed:
   - Update only the affected FUNCTION blocks.
   - Update the `[YYYY-MM-DD]` date on each changed FUNCTION line to today.
   - Preserve unchanged FUNCTION blocks and their original dates.
   - Update the `// synced:` timestamp in the file header to the current ISO timestamp.
6. If functions were added, add new FUNCTION blocks with today's date.
7. If functions were removed, remove their FUNCTION blocks.

## Step 4: Report

After processing, report:
- How many files were processed
- How many `.pseudo` files were created vs updated vs skipped

## Sync

When invoked as `/pseudocode sync`:

### Step 1 — Determine the sync window

Read `.pseudo-sync` for the last global sync timestamp:
```bash
cat .pseudo-sync 2>/dev/null
```

If `.pseudo-sync` exists, use its timestamp as the `since` cutoff.
If it doesn't exist, fall back to the `.pseudo-needs-update` manifest, or if that's also absent, use `HEAD~1` (last commit only).

### Step 2 — Find changed source files since last sync

```bash
git log --since="<timestamp>" --name-only --diff-filter=AMR --format="" \
  | sort -u \
  | grep -E '\.(ts|tsx|js|jsx|mjs|py|go|rs|rb|java|swift|kt|c|cpp|h)$' \
  | grep -v -E '(\.test\.|\.spec\.|__tests__|node_modules|dist/|build/|\.d\.ts$)'
```

If `.pseudo-needs-update` also exists, union its contents with the git log results (catches any files the hook may have recorded before the timestamp was written).

### Step 3 — Filter to files that actually need updating

For each candidate source file, check whether its pseudo sibling's `synced:` timestamp is older than the file's last git commit:

```bash
# Last commit touching this source file
git log -1 --format="%aI" -- <source-file>

# The synced: timestamp from the .pseudo file header
grep '// synced:' <file>.pseudo | head -1
```

If `last-commit > synced-timestamp` → needs update. Otherwise skip.

This avoids re-processing files where the commit that changed them was already captured in a previous sync.

### Step 4 — Process each file that needs updating

Run the normal **Step 3** update logic (generate or update) for each file. Process one at a time so failures don't block the rest.

### Step 5 — Record the sync

Write the current timestamp to `.pseudo-sync`:
```bash
date -u +%Y-%m-%dT%H:%M:%SZ > .pseudo-sync
```

Clear the manifest if it exists:
```bash
rm -f .pseudo-needs-update
```

### Step 6 — Commit everything

```bash
git add '*.pseudo' .pseudo-sync
git commit -m "chore: sync pseudo files [$(date -u +%Y-%m-%d)]"
```

### Step 7 — Report

How many files were: checked / updated / skipped (already current) / failed.
Include the new sync timestamp and the window that was covered (e.g. "Synced changes from 2026-03-20T09:00:00Z to now").

## Install

When invoked as `/pseudocode install`:

This sets up automatic pseudo-staleness tracking in the current project so that every future commit automatically records which source files changed.

**Step 1 — Install the git post-commit hook:**

```bash
cp scripts/post-commit .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

Verify it installed:
```bash
ls -la .git/hooks/post-commit
```

**Step 2 — Make hook scripts executable:**

```bash
chmod +x scripts/pseudo-track-commit.sh
chmod +x scripts/pseudo-hook-check.sh
chmod +x scripts/post-commit
```

**Step 3 — Verify `.claude/settings.json` has the PostToolUse hook.**

Read `.claude/settings.json`. If the `pseudo-hook-check.sh` hook is already present, skip. If the file doesn't exist or the hook is missing, add it:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/pseudo-hook-check.sh"
          }
        ]
      }
    ]
  }
}
```

If the file already has other hooks, merge carefully — don't overwrite existing entries.

**Step 4 — Report:**

```
Pseudo tracking installed:
  ✓ .git/hooks/post-commit (direct commits from terminal)
  ✓ .claude/settings.json PostToolUse hook (Claude-initiated commits)

Run /pseudocode sync after your next commit to update stale pseudo files.
```

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
