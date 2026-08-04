/**
 * One-shot script to repair dead buckets by calling the shipped reviveTerminalBuckets
 * against a real project root, then verify the repair via SQL query.
 *
 * Usage: bun scripts/repair-dead-buckets.ts [project-root]
 * If project-root is omitted, defaults to process.cwd().
 *
 * This script proves reviveTerminalBuckets against the REAL live ledger, not a throwaway db.
 */

import { reviveTerminalBuckets, openDb } from '../src/services/todo-store';

async function main() {
  const project = process.argv[2] ?? process.cwd();

  console.log(`\n🔧 Repair dead buckets`);
  console.log(`   project: ${project}`);
  console.log('');

  // Call the shipped reviveTerminalBuckets to repair terminal buckets
  console.log('Calling reviveTerminalBuckets...');
  const revived = await reviveTerminalBuckets(project);
  console.log(`Revived bucket IDs: ${revived.join(', ') || '(none)'}`);
  console.log('');

  // Open the db and run verification query
  console.log('Verification SELECT:');
  const db = openDb(project);
  const verification = db
    .prepare(
      `SELECT substr(id,1,8), status, bucketType, substr(parentId,1,8)
       FROM todos
       WHERE id LIKE 'a41c8051%'
          OR id LIKE '95e9ba73%'
          OR id LIKE 'bb4a9a5d%'
          OR id LIKE 'f3d19a6b%'
          OR id LIKE '92c4467d%'
          OR id LIKE '298886f9%'
       ORDER BY id`,
    )
    .all() as Array<{ 'substr(id,1,8)': string; status: string; bucketType: string | null; 'substr(parentId,1,8)': string | null }>;

  if (verification.length === 0) {
    console.log('(no rows found)');
  } else {
    console.log('idPrefix | status    | bucketType | parentIdPrefix');
    console.log('---------|-----------|------------|----------------');
    for (const row of verification) {
      const idPrefix = row['substr(id,1,8)'];
      const status = row.status;
      const bucketType = row.bucketType ?? '(null)';
      const parentIdPrefix = row['substr(parentId,1,8)'] ?? '(null)';
      console.log(`${idPrefix} | ${status.padEnd(9)} | ${bucketType.padEnd(10)} | ${parentIdPrefix}`);
    }
  }

  console.log('');
}

await main();
