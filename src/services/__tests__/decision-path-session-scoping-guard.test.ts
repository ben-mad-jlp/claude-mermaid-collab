/**
 * Decision-path session-scoping guard: decision-module sources must not read ownerSession
 * or assigneeSession by identity. These fields are attribution-only and must never influence
 * mission/criterion selection or control-flow logic.
 *
 * This test enforces that scoped decision-path files have zero ownerSession/assigneeSession
 * identifier references, except in reserve-leaf.ts where they are marked attribution-only.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Strip block comments, line comments, and string/template literals from source code.
 * Returns the source with those elements replaced by empty strings.
 */
function stripCommentsAndStrings(src: string): string {
  let result = src;
  // Remove block comments /* ... */
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments //...
  result = result.replace(/\/\/.*$/gm, '');
  // Remove single-quoted strings
  result = result.replace(/'(?:\\.|[^'\\])*'/g, '');
  // Remove double-quoted strings
  result = result.replace(/"(?:\\.|[^"\\])*"/g, '');
  // Remove template literals
  result = result.replace(/`(?:\\.|[^`\\])*`/g, '');
  return result;
}

/**
 * Find all whole-word matches of ownerSession or assigneeSession in the stripped source.
 * Returns the matched identifier names (or empty array if none found).
 */
function findSessionIdentifierHits(stripped: string): string[] {
  const matches: string[] = [];
  const sessionRegex = /\b(ownerSession|assigneeSession)\b/g;
  let match;
  while ((match = sessionRegex.exec(stripped)) !== null) {
    matches.push(match[1]!);
  }
  return matches;
}

describe('decision-path-session-scoping-guard', () => {
  it('each decision-path source file has zero ownerSession/assigneeSession identifier occurrences', () => {
    const scopeFiles = [
      'conductor-pass.ts',
      'conductor-land-arm.ts',
      'conductor-infra-arm.ts',
      'conductor-redecompose-arm.ts',
      'conductor-verify-panel-arm.ts',
      'conductor-card-triage-arm.ts',
      'conductor-test-only-close-arm.ts',
      'coordinator-core.ts',
      'coordinator-daemon.ts',
      'coordinator-land.ts',
      'coordinator-live.ts',
      'leaf-executor.ts',
      'worker-pool.ts',
      'claimability.ts',
      'mission-loop.ts',
      'nudge-target.ts',
    ];

    const serviceDir = join(import.meta.dir, '..');

    for (const fileName of scopeFiles) {
      const filePath = join(serviceDir, fileName);

      // Assert file exists loudly
      expect(existsSync(filePath)).toBe(true);
      if (!existsSync(filePath)) {
        throw new Error(`Scope file does not exist: ${fileName}`);
      }

      const content = readFileSync(filePath, 'utf-8');
      const stripped = stripCommentsAndStrings(content);
      const hits = findSessionIdentifierHits(stripped);

      expect(hits.length).toBe(0);
      if (hits.length > 0) {
        throw new Error(
          `${fileName} contains session-identity reads: ${hits.join(', ')} — decision paths must not reference ownerSession or assigneeSession by identity`
        );
      }
    }
  });

  it('reserve-leaf.ts occurrences are all marked // attribution-only', () => {
    const serviceDir = join(import.meta.dir, '..');
    const filePath = join(serviceDir, 'reserve-leaf.ts');

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/\b(ownerSession|assigneeSession)\b/.test(line)) {
        const trimmed = line.trim();
        expect(trimmed.endsWith('// attribution-only')).toBe(true);
        if (!trimmed.endsWith('// attribution-only')) {
          throw new Error(
            `Line ${i + 1} in reserve-leaf.ts contains ownerSession/assigneeSession but is not marked // attribution-only: ${trimmed}`
          );
        }
      }
    }
  });

  it('resolveActiveMissionId body in todo-store.ts is free of session-identity reads', () => {
    const serviceDir = join(import.meta.dir, '..');
    const filePath = join(serviceDir, 'todo-store.ts');

    const content = readFileSync(filePath, 'utf-8');

    // Find the function definition and extract its body.
    const functionStart = content.indexOf('async function resolveActiveMissionId(');
    expect(functionStart).toBeGreaterThanOrEqual(0);
    if (functionStart < 0) {
      throw new Error('resolveActiveMissionId function not found in todo-store.ts');
    }

    // Find the end of the function: the closing brace followed by newline at top level.
    // Simplest approach: find the first `\n}\n` after the function start.
    const searchFrom = functionStart;
    const endMarkerIndex = content.indexOf('\n}\n', searchFrom);
    expect(endMarkerIndex).toBeGreaterThanOrEqual(0);
    if (endMarkerIndex < 0) {
      throw new Error('Could not locate end of resolveActiveMissionId function');
    }

    const functionBody = content.substring(functionStart, endMarkerIndex + 3); // Include the closing brace
    const stripped = stripCommentsAndStrings(functionBody);
    const hits = findSessionIdentifierHits(stripped);

    expect(hits.length).toBe(0);
    if (hits.length > 0) {
      throw new Error(
        `resolveActiveMissionId body contains session-identity reads: ${hits.join(', ')} — this decision function must not read ownerSession or assigneeSession`
      );
    }
  });

  it('detector flags a seeded ownerSession-branch fixture', () => {
    const fixture = `
      export function mockDecisionPath(todo: Todo): boolean {
        if (todo.ownerSession === session) return null;
        return true;
      }
    `;

    const stripped = stripCommentsAndStrings(fixture);
    const hits = findSessionIdentifierHits(stripped);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain('ownerSession');
  });

  it('detector does not flag comment/string-only occurrences', () => {
    const fixture = `
      // this mentions ownerSession in a comment, should be stripped
      const msg = "assigneeSession is just a label here";
      const description = \`ownerSession is explained in the docs\`;
    `;

    const stripped = stripCommentsAndStrings(fixture);
    const hits = findSessionIdentifierHits(stripped);

    expect(hits).toEqual([]);
  });
});
