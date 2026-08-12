/**
 * One-shot script to repair duplicate flaky-quarantine todos by calling the shipped
 * collapseQuarantineDuplicates against a real project root, then verify the repair via
 * a grouped SQL query.
 *
 * Usage: bun run scripts/repair-flaky-quarantine-dups.ts [project-root]
 * If project-root is omitted, defaults to process.cwd().
 *
 * This script proves collapseQuarantineDuplicates against the REAL live ledger, not a
 * throwaway db.
 */

import { collapseQuarantineDuplicates, quarantineDedupKey } from '../src/services/quarantine-dedup';
import { openDb } from '../src/services/todo-store';

export const QUARANTINE_TITLE_PREFIX = '[BUG] flaky test quarantined: ';

export function countOpenQuarantineDupKeys(
  project: string,
): { total: number; dupKeys: Array<{ key: string; count: number }> } {
  const db = openDb(project);
  const rows = db
    .prepare(
      `SELECT title FROM todos WHERE title LIKE ? AND status NOT IN ('done','dropped')`,
    )
    .all(`${QUARANTINE_TITLE_PREFIX}%`) as Array<{ title: string }>;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = quarantineDedupKey(row.title.slice(QUARANTINE_TITLE_PREFIX.length));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const dupKeys = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));

  return { total: rows.length, dupKeys };
}

async function main() {
  const project = process.argv[2] ?? process.cwd();

  console.log(`\nRepair flaky-quarantine duplicates`);
  console.log(`   project: ${project}`);
  console.log('');

  const before = countOpenQuarantineDupKeys(project);
  console.log(
    `Before: total=${before.total} dupKeys=${before.dupKeys.length} ` +
      `${JSON.stringify(before.dupKeys)}`,
  );

  const result = await collapseQuarantineDuplicates(project);
  console.log(
    `collapseQuarantineDuplicates result: groups=${result.groups} survivors=${result.survivors} closed=${result.closed}`,
  );

  const after = countOpenQuarantineDupKeys(project);
  console.log(
    `After: total=${after.total} dupKeys=${after.dupKeys.length} ` +
      `${JSON.stringify(after.dupKeys)}`,
  );

  if (after.dupKeys.length > 0) {
    console.log('VERIFICATION FAILED — duplicate keys remain open:');
    for (const dup of after.dupKeys) {
      console.log(`  ${dup.key}: ${dup.count}`);
    }
    process.exit(1);
  }

  console.log(`VERIFICATION PASSED — 0 open duplicate keys, total open quarantine rows=${after.total}`);
}

if (import.meta.main) {
  main();
}
