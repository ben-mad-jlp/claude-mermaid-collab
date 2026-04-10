#!/usr/bin/env bun
/**
 * bin/structural-index-project.ts
 *
 * One-shot full-project structural scan. Used by the schema v2 migration
 * and by users who want to force a complete re-index. Walks the source tree
 * recursively and upserts every supported file.
 */

import { execFileSync } from 'child_process';
import { extname, join, resolve } from 'path';
import { readdirSync } from 'fs';
import { scanSourceFile, isSupportedExtension } from '../src/services/source-scanner';
import { getPseudoDb } from '../src/services/pseudo-db';

const EXCLUDES = new Set([
  'node_modules', '.git', '.collab', '.worktrees', 'dist', 'build', 'out',
  '.next', '.nuxt', 'coverage', '.cache', '__pycache__', '__tests__',
]);

function walkSourceTree(dir: string, out: string[]): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    if (EXCLUDES.has(name)) continue;
    if (name.startsWith('.')) continue;
    if (name.includes('.test.') || name.includes('.spec.') || name.endsWith('.d.ts')) continue;

    const full = join(dir, name);
    if (entry.isDirectory()) {
      walkSourceTree(full, out);
    } else if (entry.isFile()) {
      const ext = extname(name).toLowerCase();
      if (isSupportedExtension(ext)) {
        out.push(full);
      }
    }
  }
}

async function main(): Promise<void> {
  const projectRoot = resolve(process.argv[2] || process.cwd());
  const files: string[] = [];
  walkSourceTree(projectRoot, files);

  console.log(`[pseudo-db] scanning ${files.length} source files...`);

  const db = getPseudoDb(projectRoot);

  let indexed = 0;
  let methodCount = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const scan = scanSourceFile(file);
      if (!scan) {
        failed++;
        continue;
      }
      db.upsertStructural(file, scan.language, scan);
      indexed++;
      methodCount += scan.methods.length;
      if (indexed % 50 === 0) {
        console.log(`  ${indexed}/${files.length}`);
      }
    } catch (err: any) {
      console.error(`  failed ${file}: ${err?.message ?? err}`);
      failed++;
    }
  }

  try {
    db.checkpointWal();
  } catch (err: any) {
    console.error('checkpointWal failed:', err?.message ?? err);
  }

  try {
    const dbPath = join(projectRoot, '.collab', 'pseudo', 'pseudo.db');
    execFileSync('git', ['add', dbPath], { cwd: projectRoot, stdio: 'pipe' });
  } catch (err: any) {
    console.error('git add failed:', err?.message ?? err);
  }

  console.log(`[pseudo-db] Indexed ${indexed} files (${methodCount} methods, ${failed} errors)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('structural-index-project crashed:', err);
  process.exit(1);
});
