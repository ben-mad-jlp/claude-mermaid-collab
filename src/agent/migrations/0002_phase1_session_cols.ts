import type { Database } from 'bun:sqlite';

interface ColumnSpec {
  name: string;
  ddl: string;
}

const PHASE1_COLUMNS: ColumnSpec[] = [
  { name: 'model', ddl: 'model TEXT' },
  { name: 'effort', ddl: 'effort TEXT' },
  { name: 'display_name', ddl: 'display_name TEXT' },
  { name: 'total_cost_usd', ddl: 'total_cost_usd REAL NOT NULL DEFAULT 0' },
  { name: 'total_input_tokens', ddl: 'total_input_tokens INTEGER NOT NULL DEFAULT 0' },
  { name: 'total_output_tokens', ddl: 'total_output_tokens INTEGER NOT NULL DEFAULT 0' },
  { name: 'total_cache_read_tokens', ddl: 'total_cache_read_tokens INTEGER NOT NULL DEFAULT 0' },
  { name: 'total_cache_creation_tokens', ddl: 'total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0' },
  { name: 'last_activity_ts', ddl: 'last_activity_ts INTEGER' },
];

export function migrate0002(db: Database): void {
  try {
    const versionRow = db.prepare('PRAGMA user_version').get() as
      | { user_version: number }
      | undefined;
    const current = versionRow?.user_version ?? 0;
    if (current >= 2) return;

    const infoRows = db
      .prepare('PRAGMA table_info(agent_sessions)')
      .all() as Array<{ name: string }>;
    const existing = new Set(infoRows.map((r) => r.name));

    const tx = db.transaction(() => {
      for (const spec of PHASE1_COLUMNS) {
        if (!existing.has(spec.name)) {
          db.exec(`ALTER TABLE agent_sessions ADD COLUMN ${spec.ddl}`);
        }
      }
      db.exec('PRAGMA user_version = 2');
    });
    tx();
  } catch (err) {
    throw new Error(
      `migrate0002 failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
