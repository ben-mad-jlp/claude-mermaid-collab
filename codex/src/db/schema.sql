-- Collab Codex Database Schema
-- SQLite database for knowledge base metadata storage

-- Topics table: Core knowledge base entries
CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,                              -- Topic identifier (slug)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),     -- ISO timestamp
    last_modified_at TEXT NOT NULL DEFAULT (datetime('now')), -- ISO timestamp
    last_verified_at TEXT,                                  -- ISO timestamp, NULL if never verified
    confidence_tier TEXT NOT NULL DEFAULT 'low' CHECK (confidence_tier IN ('high', 'medium', 'low')),
    has_draft INTEGER NOT NULL DEFAULT 0 CHECK (has_draft IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_topics_name ON topics(name);
CREATE INDEX IF NOT EXISTS idx_topics_confidence ON topics(confidence_tier);
CREATE INDEX IF NOT EXISTS idx_topics_has_draft ON topics(has_draft);

-- Flags table: Issues/concerns raised on topics
CREATE TABLE IF NOT EXISTS flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    comment TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'addressed', 'resolved', 'dismissed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    addressed_at TEXT,                                      -- When flag was addressed
    resolved_at TEXT,                                       -- When flag was resolved
    dismiss_reason TEXT,                                    -- Reason if dismissed
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_flags_topic_id ON flags(topic_id);
CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status);

-- Access log table: Individual access events for detailed tracking
CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_log_topic_id ON access_log(topic_id);
CREATE INDEX IF NOT EXISTS idx_access_log_accessed_at ON access_log(accessed_at);

-- Access counts table: Aggregated access statistics
CREATE TABLE IF NOT EXISTS access_counts (
    topic_id INTEGER PRIMARY KEY,
    total_count INTEGER NOT NULL DEFAULT 0,
    last_30_days INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
);

-- Missing topics table: Track requested but non-existent topics
CREATE TABLE IF NOT EXISTS missing_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    requested_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_missing_topics_name ON missing_topics(name);
CREATE INDEX IF NOT EXISTS idx_missing_topics_count ON missing_topics(requested_count DESC);
