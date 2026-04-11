# Pseudo-DB v6 Migration Guide

Pseudo-DB v6 rebuilds the initial-population flow to be auto-triggered, multi-language, branch-aware, and human-debuggable. This document explains what changed, how to migrate, and how to handle the new warnings.

## What changed

| Aspect | v1/v2 | v6 |
|---|---|---|
| Storage | File-backed SQLite at `.collab/pseudo/pseudo.db` | `:memory:` SQLite + committed prose files |
| Committed artifacts | A monolithic SQLite file (not human-diffable) | One JSON file per source file with prose, under `.collab/pseudo/prose/` |
| Identity | Auto-increment method ids (unstable across scans) | Deterministic `m_xxxxxxxx` ids from `(file, class, name, normalized_params)` |
| Drift detection | Manual rescan | 4-layer: watcher + 5 min periodic + 30 s idle + explicit |
| Rename detection | None | Body fingerprint match with 6-level fallback |
| Warm start | — | `.cache/derived.sqlite` snapshot with validation (file count ±5%, 30 random hashes, 7 day TTL) |
| Multi-language structure | TS/JS/PY/C#/C++ regex | + Go/Rust/Java/Kotlin/Ruby via optional ctags |

## How prose files are committed

Each source file with prose gets a committed JSON file at:

```
.collab/pseudo/prose/<escaped-path>.json
```

The escaped path uses forward slashes, Windows reserved-name escaping (`CON` → `CON_`), forbidden-char replacement, and a collision hash suffix when escaping occurs.

Prose files are schema version 3 (`ProseFileV3`). Schema is validated on both read and write.

## Handling rename warnings

When a method is renamed or moved, the overlay flags it with a `match_quality`:
- `fuzzy_rename` — same body fingerprint in the same file
- `fuzzy_move` — same body fingerprint across files
- `param_mismatch` — signature drifted
- `class_mismatch` — moved between classes

To approve, call:
```
pseudo_reassign_prose(project, { file, old: {...}, new: {...} })
```

For post-refactor batches:
```
pseudo_reassign_prose_bulk(project, mappings, confirm=true)
```

## Opting out with .pseudoignore

Place a `.pseudoignore` file at the project root. Syntax is gitignore-like:
```
*.generated.ts
vendor/
scratch/
```

Patterns are layered on top of `.gitignore`.

## OneDrive / WSL2 caveats

Filesystem watchers and atomic rename semantics can misbehave on:
- OneDrive-synced folders (rename events are out-of-order; watcher may miss updates)
- WSL2 accessing Windows filesystems (stat mtime is lossy)

Workarounds: run the server on a native filesystem, or force periodic rescan via `pseudo_rescan({ mode: 'full' })` on startup.

## Cache modes

The status tool reports three `cacheMode` values:
- `warm-loaded` — snapshot was valid, loaded successfully; background refresh running
- `cold` — no snapshot or validation failed; cold rescan in progress
- `memory` — in-memory only, no snapshot persistence yet

## Migration from v1/v2

One-time migration runs automatically on first call to `initPseudoDbV6`:
1. Detects legacy `.collab/pseudo/pseudo.db`
2. Extracts files with `has_prose=1` into reconstructed `ProseFileV3` entries
3. Writes each to `.collab/pseudo/prose/<escaped>.json`
4. Removes legacy `pseudo.db`, `pseudo.db-wal`, `pseudo.db-shm`
5. Writes `.collab/pseudo/.migrated` flag

Subsequent server starts skip the migration if the flag exists.
