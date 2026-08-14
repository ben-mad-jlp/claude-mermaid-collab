/**
 * Backfill friction_notes.signature column with computed values.
 *
 * The signature column is owned by epic 930cc096; this script consumes
 * the computeFrictionSignature function via runtime import to avoid
 * add/add conflict during forward-integration on bases where that epic
 * has not yet landed.
 *
 * Idempotent: rows with non-empty signature are skipped; a second run
 * over the same db reports updated: 0.
 *
 * Usage: bun run scripts/backfill-friction-signatures.ts [dbPath] [--dry-run]
 * Default dbPath: .collab/friction.db (relative to cwd)
 * Default: applies changes (no --dry-run). Pass --dry-run to skip writes.
 */

import Database from 'bun:sqlite';
import { join } from 'node:path';

export interface FrictionSignatureRow {
  id: string;
  layer: string;
  retryReason: string;
  detail: string | null;
  todoId: string | null;
}

export interface BackfillReport {
  scanned: number;
  updated: number;
  skipped: number;
}

/**
 * Backfill friction_notes.signature column with computed values.
 * Rows with existing non-empty signatures are left alone (idempotent).
 *
 * @param dbPath - Path to the friction.db database file
 * @param computeSignature - Function that computes a signature from a row
 * @param opts - { dryRun?: boolean }
 * @returns { scanned, updated, skipped } counts
 * @throws if the signature column does not exist
 */
export function backfillFrictionSignatures(
  dbPath: string,
  computeSignature: (row: FrictionSignatureRow) => string,
  opts?: { dryRun?: boolean },
): BackfillReport {
  const db = new Database(dbPath);

  try {
    // Guard: check for signature column before any writes
    const columns = db.prepare('PRAGMA table_info(friction_notes)').all() as Array<{ name: string }>;
    const hasSignatureColumn = columns.some((col) => col.name === 'signature');

    if (!hasSignatureColumn) {
      throw new Error(
        'friction_notes table is missing the signature column. ' +
          'Epic 930cc096 has not been integrated. ' +
          'Cannot proceed with backfill.',
      );
    }

    // Count rows needing work (signature IS NULL OR signature = '')
    const needsWorkResult = db.prepare('SELECT COUNT(*) as cnt FROM friction_notes WHERE signature IS NULL OR signature = \'\'').get() as {
      cnt: number;
    };
    const scanned = needsWorkResult.cnt;

    // Count rows already populated (signature IS NOT NULL AND signature <> '')
    const alreadySignedResult = db
      .prepare("SELECT COUNT(*) as cnt FROM friction_notes WHERE signature IS NOT NULL AND signature <> ''")
      .get() as { cnt: number };
    const skipped = alreadySignedResult.cnt;

    if (opts?.dryRun) {
      // Dry-run: report without modifying
      return { scanned, updated: 0, skipped };
    }

    // Read rows needing work
    const rowsToUpdate = db
      .prepare('SELECT id, layer, retryReason, detail, todoId FROM friction_notes WHERE signature IS NULL OR signature = \'\'')
      .all() as FrictionSignatureRow[];

    // Update within a transaction
    const updateStmt = db.prepare('UPDATE friction_notes SET signature = ? WHERE id = ?');
    db.transaction(() => {
      for (const row of rowsToUpdate) {
        const sig = computeSignature(row);
        updateStmt.run(sig, row.id);
      }
    })();

    return { scanned, updated: scanned, skipped };
  } finally {
    db.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let dbPath = join(process.cwd(), '.collab', 'friction.db');
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (!arg.startsWith('-')) {
      dbPath = arg;
    }
  }

  // Runtime seam lookup. The recurrence work landed computeFrictionSignature in
  // friction-signature.ts with a (retryReason, detail) shape — not the row shape this
  // script anticipated from friction-store — so probe the real home first and adapt;
  // the legacy probe stays as a fallback for older checkouts.
  let computeSignature: ((row: FrictionSignatureRow) => string) | null = null;
  try {
    const mod = await import('../src/services/friction-signature.js');
    const fn = (mod as any).computeFrictionSignature;
    if (typeof fn === 'function') {
      computeSignature = (row: FrictionSignatureRow) => fn(row.retryReason, row.detail);
    }
  } catch {
    // Module does not exist on this checkout
  }
  if (!computeSignature) {
    try {
      const mod = await import('../src/services/friction-store.js');
      computeSignature = (mod as any).computeFrictionSignature;
    } catch {
      // Module or export does not exist yet
    }
  }

  if (typeof computeSignature !== 'function') {
    console.log('signature seam not present on this build (epic 930cc096 not yet integrated) — nothing was written');
    process.exit(1);
  }

  try {
    const report = backfillFrictionSignatures(dbPath, computeSignature, { dryRun });
    console.log(`scanned=${report.scanned} updated=${report.updated} skipped=${report.skipped}`);
  } catch (err: any) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
