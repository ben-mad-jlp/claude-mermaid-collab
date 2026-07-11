# Wave 1 — one-click-collab-launch

## Tasks
- **server-resolver** (new) — `resolveServerSource()`: rootDir via MERMAID_COLLAB_ROOT → CLAUDE_PLUGIN_ROOT → highest-semver cache; bun via BUN_PATH → which/where.exe → ~/.bun fallback. Clean first try.
- **spawn-server** (new) — `spawnCollabServer()` + `AlreadyRunning`. Inline deriveSessionId, pre-flight dup detection, line-buffered stdio. One fix: `output` not destructured from `opts` (14 TS2304) → fixed.
- **extension-manifest** — version 1.0.16→1.0.17, +3 commands. Clean.

## Wave TSC
Clean — no errors in wave-1 files.
