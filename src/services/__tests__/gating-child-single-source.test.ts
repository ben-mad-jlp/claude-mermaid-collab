/**
 * Source-guard: the inline gating-child filter pattern must appear EXACTLY ONCE in
 * production code (in the epicGatingChildren helper), never hand-copied at call sites.
 *
 * The acceptance clause: *the pattern `parentId === epicId && t.status !== 'dropped'`
 * (with no further land-kind filter — land leaves are never minted, so buildChildren
 * is just "all non-dropped children") appears exactly once across src/services
 * (excluding __tests__), and only in coordinator-live.ts or coordinator-land.ts (the
 * landing subsystem MOVED there — see epicGatingChildren)*. This guard prevents a
 * fourth hand-copied filter from being added without detection.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('gating-child-single-source — source-guard for hand-copied filters', () => {
  it('finds the gating-child filter exactly once and only in coordinator-live.ts or coordinator-land.ts', () => {
    // The pattern: parentId === <word> && t.status !== 'dropped', anchored on the
    // trailing comma so it doesn't also match land-authority.ts's checkLandDeps
    // sibling filter, which chains a further `&& !isLandTodo(t)` onto the same prefix.
    const PATTERN = /parentId === \w+ && t\.status !== 'dropped',/g;

    const serviceDir = join(import.meta.dir, '..');
    const matches: { file: string; count: number }[] = [];
    let totalMatches = 0;

    const walkDir = (dir: string) => {
      // Skip __tests__ directories
      if (dir.endsWith('__tests__')) return;

      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (stat.isFile() && fullPath.endsWith('.ts') && !fullPath.endsWith('.test.ts')) {
          const content = readFileSync(fullPath, 'utf-8');
          const fileMatches = content.match(PATTERN) ?? [];
          if (fileMatches.length > 0) {
            totalMatches += fileMatches.length;
            matches.push({
              file: fullPath,
              count: fileMatches.length,
            });
          }
        }
      }
    };

    walkDir(serviceDir);

    // Assert: exactly one match total
    expect(totalMatches).toBe(1);

    // Assert: match is only in coordinator-live.ts or coordinator-land.ts (the landing
    // subsystem, incl. epicGatingChildren, was extracted there — MOVE ONLY, same guard).
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toMatch(/coordinator-(live|land)\.ts$/);
    expect(matches[0].count).toBe(1);
  });
});
