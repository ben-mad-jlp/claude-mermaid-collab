import type { Database } from 'bun:sqlite';

export function migrate0003(db: Database): void {
  const row = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
  const current = row?.user_version ?? 0;
  if (current >= 3) return;

  const tx = db.transaction(() => {
    db.exec(
      'CREATE TABLE IF NOT EXISTS agent_attachments (' +
        'attachment_id TEXT PRIMARY KEY, ' +
        'session_id TEXT NOT NULL, ' +
        'mime_type TEXT NOT NULL, ' +
        'byte_size INTEGER NOT NULL, ' +
        'width INTEGER, ' +
        'height INTEGER, ' +
        'path TEXT NOT NULL, ' +
        'created_at INTEGER NOT NULL, ' +
        'referenced_in_seq INTEGER' +
      ')',
    );
    db.exec('PRAGMA user_version = 3');
  });

  try {
    tx();
  } catch (err) {
    throw new Error(`migrate0003 failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
