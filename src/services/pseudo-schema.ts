/**
 * Pseudo DB Schema (v6 / SCHEMA_VERSION 3)
 *
 * DDL-only module: exports createSchema() and dropSchema() helpers.
 * Supports two-level indexing (structural + prose), body-fingerprint matching,
 * cross-branch orphan prose detection, scan run telemetry, and FTS5.
 */

import type { Database } from 'bun:sqlite';

export const SCHEMA_VERSION = 3;

const DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  file_path TEXT PRIMARY KEY,
  source_hash TEXT,
  title TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  module_context TEXT NOT NULL DEFAULT '',
  file_prose_origin TEXT NOT NULL DEFAULT 'none'
    CHECK (file_prose_origin IN ('heuristic','manual','llm','mixed','none')),
  priority INTEGER NOT NULL DEFAULT 0,
  touch_count_90d INTEGER NOT NULL DEFAULT 0,
  owner TEXT,
  last_touched TEXT,
  lines INTEGER NOT NULL DEFAULT 0,
  stub INTEGER NOT NULL DEFAULT 0,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS methods (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL REFERENCES files(file_path) ON DELETE CASCADE,
  enclosing_class TEXT,
  name TEXT NOT NULL,
  normalized_params TEXT NOT NULL DEFAULT '',
  body_fingerprint TEXT,
  is_async INTEGER NOT NULL DEFAULT 0,
  is_exported INTEGER NOT NULL DEFAULT 0,
  start_line INTEGER,
  end_line INTEGER,
  prose_origin TEXT NOT NULL DEFAULT 'none'
    CHECK (prose_origin IN ('heuristic','manual','llm','mixed','none')),
  match_quality TEXT,
  warning TEXT
);

CREATE TABLE IF NOT EXISTS method_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method_id TEXT NOT NULL REFERENCES methods(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  content TEXT NOT NULL,
  UNIQUE(method_id, "order")
);

CREATE TABLE IF NOT EXISTS method_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_method_id TEXT NOT NULL REFERENCES methods(id) ON DELETE CASCADE,
  callee_name TEXT NOT NULL,
  callee_method_id TEXT REFERENCES methods(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL REFERENCES files(file_path) ON DELETE CASCADE,
  imported_path TEXT NOT NULL,
  UNIQUE(file_path, imported_path)
);

CREATE TABLE IF NOT EXISTS overlay_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method_row_id TEXT NOT NULL REFERENCES methods(id) ON DELETE CASCADE,
  quality TEXT NOT NULL,
  warning TEXT
);

CREATE TABLE IF NOT EXISTS orphan_prose (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prose_file_path TEXT NOT NULL,
  source_path TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('cross-branch-orphan','orphan-candidate')),
  suggestions TEXT NOT NULL DEFAULT '[]',
  UNIQUE(prose_file_path)
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running','done','failed','cancelled')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  files_scanned INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  error_msg TEXT
);

CREATE TABLE IF NOT EXISTS scan_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  error_msg TEXT NOT NULL,
  phase TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS pseudo_fts USING fts5(
  title,
  purpose,
  step_content,
  method_names,
  content='',
  contentless_delete=1,
  tokenize='porter unicode61'
);

CREATE INDEX IF NOT EXISTS idx_files_priority ON files(priority DESC);
CREATE INDEX IF NOT EXISTS idx_files_last_touched ON files(last_touched);
CREATE INDEX IF NOT EXISTS idx_files_stub ON files(stub);

CREATE INDEX IF NOT EXISTS idx_methods_file_path ON methods(file_path);
CREATE INDEX IF NOT EXISTS idx_methods_name ON methods(name);
CREATE INDEX IF NOT EXISTS idx_methods_class_name ON methods(enclosing_class, name);
CREATE INDEX IF NOT EXISTS idx_methods_body_fp ON methods(body_fingerprint);
CREATE INDEX IF NOT EXISTS idx_methods_prose_origin ON methods(prose_origin);

CREATE INDEX IF NOT EXISTS idx_method_steps_method ON method_steps(method_id);

CREATE INDEX IF NOT EXISTS idx_method_calls_caller ON method_calls(caller_method_id);
CREATE INDEX IF NOT EXISTS idx_method_calls_callee_name ON method_calls(callee_name);
CREATE INDEX IF NOT EXISTS idx_method_calls_callee_id ON method_calls(callee_method_id);
CREATE INDEX IF NOT EXISTS idx_method_calls_file ON method_calls(file_path);

CREATE INDEX IF NOT EXISTS idx_file_imports_file ON file_imports(file_path);
CREATE INDEX IF NOT EXISTS idx_file_imports_target ON file_imports(imported_path);

CREATE INDEX IF NOT EXISTS idx_overlay_matches_method ON overlay_matches(method_row_id);
CREATE INDEX IF NOT EXISTS idx_overlay_matches_quality ON overlay_matches(quality);

CREATE INDEX IF NOT EXISTS idx_orphan_prose_status ON orphan_prose(status);
CREATE INDEX IF NOT EXISTS idx_orphan_prose_source ON orphan_prose(source_path);

CREATE INDEX IF NOT EXISTS idx_scan_runs_status ON scan_runs(status);
CREATE INDEX IF NOT EXISTS idx_scan_runs_started ON scan_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_errors_run ON scan_errors(scan_run_id);
CREATE INDEX IF NOT EXISTS idx_scan_errors_file ON scan_errors(file_path);
`;

const DROP_DDL = `
DROP TABLE IF EXISTS pseudo_fts;
DROP TABLE IF EXISTS scan_errors;
DROP TABLE IF EXISTS scan_runs;
DROP TABLE IF EXISTS orphan_prose;
DROP TABLE IF EXISTS overlay_matches;
DROP TABLE IF EXISTS file_imports;
DROP TABLE IF EXISTS method_calls;
DROP TABLE IF EXISTS method_steps;
DROP TABLE IF EXISTS methods;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS cache_meta;
DROP TABLE IF EXISTS schema_version;
`;

export function createSchema(db: Database): void {
  db.exec(DDL);
}

export function dropSchema(db: Database): void {
  db.exec(DROP_DDL);
}
