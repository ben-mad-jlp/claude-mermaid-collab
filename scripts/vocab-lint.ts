#!/usr/bin/env bun
/**
 * Vocabulary-lint CLI (Vocab 4). Fails (exit 1) when a CHANGED file introduces a
 * retired vocabulary synonym. Scoped to changed files so not-yet-migrated legacy
 * code is never flagged unless it is touched.
 *
 * Usage:
 *   bun run scripts/vocab-lint.ts            # diff against merge-base with origin/master (or master)
 *   bun run scripts/vocab-lint.ts <baseRef>  # diff against an explicit base ref
 *   bun run scripts/vocab-lint.ts --all      # scan the whole tracked tree (non-legacy)
 *
 * In CI, run after checkout with fetch-depth ≥ 2 so the base ref is reachable.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import {
  lintFiles,
  lintContent,
  formatViolation,
  isLintablePath,
  type VocabViolation,
} from '../src/services/vocab-lint.ts';

function sh(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function resolveBase(explicit?: string): string {
  if (explicit) return explicit;
  for (const ref of ['origin/master', 'master', 'origin/main', 'main']) {
    try {
      const base = sh(`git merge-base HEAD ${ref}`);
      if (base) return base;
    } catch {
      /* ref not present — try next */
    }
  }
  // Fallback: previous commit.
  return sh('git rev-parse HEAD~1');
}

/**
 * `git diff <base>` compares base directly to the WORKING TREE, so the `+` side
 * line numbers match the current file content (what `lintContent` sees). Returns
 * the set of net-added line numbers per changed file. Only these lines are linted
 * in changed-files mode, so a pre-existing retired synonym on an untouched line of
 * a file edited for unrelated reasons is NOT flagged — only newly added ones are.
 */
function changedFilesWithAddedLines(base: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const diff = sh(`git diff --unified=0 --diff-filter=ACMR ${base}`);
  let file: string | null = null;
  let newLine = 0;
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      file = fileMatch[1];
      if (!out.has(file)) out.set(file, new Set());
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      continue;
    }
    if (!file) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      out.get(file)!.add(newLine);
      newLine++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // deletion — does not advance the new-side counter
    } else {
      // context line (rare with --unified=0) advances the new-side counter
      newLine++;
    }
  }
  // Untracked (new, not-yet-committed) files don't appear in `git diff` — treat
  // every line as added so a brand-new file is linted too (matches CI, where the
  // PR branch's new files are committed and therefore already in the diff).
  const untracked = sh('git ls-files --others --exclude-standard')
    .split('\n').map((s) => s.trim()).filter(Boolean);
  for (const f of untracked) {
    const content = read(f);
    if (content == null) continue;
    out.set(f, new Set(content.split('\n').map((_, i) => i + 1)));
  }
  return out;
}

function allTrackedFiles(): string[] {
  return sh('git ls-files').split('\n').map((s) => s.trim()).filter(Boolean);
}

function read(f: string): string | null {
  try {
    return readFileSync(f, 'utf-8');
  } catch {
    return null;
  }
}

function main(): void {
  const arg = process.argv[2];
  let violations: VocabViolation[];
  let scannedCount: number;

  if (arg === '--all') {
    // Audit mode: whole tracked tree, full-file scan (surfaces the migration backlog).
    const scannable = allTrackedFiles().filter((f) => isLintablePath(f) && existsSync(f));
    scannedCount = scannable.length;
    violations = lintFiles(scannable, read);
  } else {
    // CI mode: changed files, but only flag NEWLY ADDED lines (don't fail on
    // pre-existing not-yet-migrated legacy lines in an unrelated edit).
    const added = changedFilesWithAddedLines(resolveBase(arg));
    const scannable = [...added.keys()].filter((f) => isLintablePath(f) && existsSync(f));
    scannedCount = scannable.length;
    violations = [];
    for (const f of scannable) {
      const content = read(f);
      if (content == null) continue;
      const addedLines = added.get(f)!;
      for (const v of lintContent(content, f)) {
        if (addedLines.has(v.line)) violations.push(v);
      }
    }
  }

  if (violations.length === 0) {
    console.log(`vocab-lint: OK (${scannedCount} file(s) scanned)`);
    return;
  }

  console.error(`vocab-lint: ${violations.length} retired-vocabulary violation(s):\n`);
  for (const v of violations) console.error('  ' + formatViolation(v));
  console.error(
    '\nUse the canonical term (see spec-canonical-vocabulary), or suppress a deliberate\n' +
      'reference with `vocab-lint-ignore-line` / `vocab-lint-ignore-next-line`.',
  );
  process.exit(1);
}

main();
