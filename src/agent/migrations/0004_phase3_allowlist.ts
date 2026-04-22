import type { Database } from 'bun:sqlite';

export function migrate0004(db: Database): void {
  const row = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
  const current = row?.user_version ?? 0;
  if (current >= 4) return;

  const tx = db.transaction(() => {
    db.exec(
      'CREATE TABLE IF NOT EXISTS agent_session_allowlist (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'session_id TEXT NOT NULL, ' +
        'project_root TEXT NOT NULL, ' +
        'rule_text TEXT NOT NULL, ' +
        'scope TEXT NOT NULL CHECK(scope IN (\'session\',\'project\',\'user\')), ' +
        'added_at INTEGER NOT NULL' +
      ')',
    );
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_allowlist_session ' +
      'ON agent_session_allowlist(session_id)',
    );
    db.exec('PRAGMA user_version = 4');
  });

  try {
    tx();
  } catch (err) {
    throw new Error(`migrate0004 failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
