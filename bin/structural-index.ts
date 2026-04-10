#!/usr/bin/env bun
/**
 * bin/structural-index.ts
 *
 * Called from the git pre-commit hook. Reads staged source files, runs the
 * Level 1 structural scanner on each, upserts into the pseudo-db, checkpoints
 * the WAL, and stages the db file for inclusion in the same commit.
 *
 * Exits 0 on scanner errors — never blocks a commit due to indexing issues.
 * Logs errors to .collab/pseudo/structural-index.log.
 */

import { execSync, execFileSync } from 'child_process';
import { resolve, extname, isAbsolute, join } from 'path';
import { appendFileSync, mkdirSync } from 'fs';
import { scanSourceFile, isSupportedExtension } from '../src/services/source-scanner';
import { getPseudoDb } from '../src/services/pseudo-db';

const projectRoot = resolve(process.argv[2] || process.cwd());

function logError(msg: string): void {
  try {
    const logDir = join(projectRoot, '.collab', 'pseudo');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, 'structural-index.log');
    appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // Can't even log — silently ignore
  }
}

function getStagedFiles(): { modified: string[]; deleted: string[] } {
  try {
    const modifiedRaw = execSync('git diff --cached --name-only --diff-filter=AMR', {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();
    const modified = modifiedRaw ? modifiedRaw.split('\n').filter(Boolean) : [];

    const deletedRaw = execSync('git diff --cached --name-only --diff-filter=D', {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();
    const deleted = deletedRaw ? deletedRaw.split('\n').filter(Boolean) : [];

    return { modified, deleted };
  } catch (err: any) {
    logError(`git diff --cached failed: ${err.message}`);
    return { modified: [], deleted: [] };
  }
}

async function main(): Promise<void> {
  const { modified, deleted } = getStagedFiles();

  if (modified.length === 0 && deleted.length === 0) {
    process.exit(0);
  }

  const db = getPseudoDb(projectRoot);

  let indexed = 0;
  for (const relPath of modified) {
    const ext = extname(relPath).toLowerCase();
    if (!isSupportedExtension(ext)) continue;

    const absPath = isAbsolute(relPath) ? relPath : resolve(projectRoot, relPath);

    try {
      const scan = scanSourceFile(absPath);
      if (!scan) continue;
      db.upsertStructural(absPath, scan.language, scan);
      indexed++;
    } catch (err: any) {
      logError(`upsertStructural failed for ${absPath}: ${err.message}`);
    }
  }

  let removed = 0;
  for (const relPath of deleted) {
    const ext = extname(relPath).toLowerCase();
    if (!isSupportedExtension(ext)) continue;

    const absPath = isAbsolute(relPath) ? relPath : resolve(projectRoot, relPath);
    try {
      db.deleteStructural(absPath);
      removed++;
    } catch (err: any) {
      logError(`deleteStructural failed for ${absPath}: ${err.message}`);
    }
  }

  try {
    db.checkpointWal();
    const dbPath = join(projectRoot, '.collab', 'pseudo', 'pseudo.db');
    execFileSync('git', ['add', dbPath], { cwd: projectRoot, stdio: 'pipe' });
  } catch (err: any) {
    logError(`wal checkpoint / git add failed: ${err.message}`);
  }

  console.log(`[pseudo-db] structural index: ${indexed} updated, ${removed} removed`);
  process.exit(0);
}

main().catch((err: any) => {
  try {
    const logDir = join(projectRoot, '.collab', 'pseudo');
    mkdirSync(logDir, { recursive: true });
    appendFileSync(
      join(logDir, 'structural-index.log'),
      `[${new Date().toISOString()}] structural-index.ts crashed: ${err?.message ?? err}\n`,
    );
  } catch {
    // ignore
  }
  process.exit(0);
});
