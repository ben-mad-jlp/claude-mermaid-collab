import { test, expect, describe } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';

const ROOT = path.resolve(import.meta.dir, '../../..');

// ============================================================================
// Scanner: walks src/ and ui/src, applies offset-preserving comment stripper
// ============================================================================

interface Hit {
  file: string;
  line: number;
  text: string;
}

interface PendingEntry {
  file: string;
  match: string;
  owner: string;
}

interface ExemptEntry {
  file: string;
  match: string;
  reason: string;
}

function sourceFiles(roots: string[]): string[] {
  const result: string[] = [];

  function walk(dir: string, root: string) {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const relPath = path.relative(ROOT, fullPath);

      // Skip special dirs
      if (
        entry === 'node_modules' ||
        entry === 'dist' ||
        entry === 'build' ||
        entry === '.collab' ||
        relPath.includes('/__tests__/') ||
        relPath.match(/\.test\.tsx?$/)
      ) {
        continue;
      }

      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath, root);
      } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
        result.push(relPath);
      }
    }
  }

  for (const root of roots) {
    const fullRoot = path.join(ROOT, root);
    if (fs.existsSync(fullRoot)) {
      walk(fullRoot, root);
    }
  }

  return result.sort();
}

// Replace block comments and line comments with spaces of equal length, preserving offsets.
// Naive: a line-comment marker inside a string literal will over-strip, causing false negatives
// (never false positives). Acceptable for this use.
function stripComments(src: string): string {
  let result = '';
  let i = 0;
  const len = src.length;

  while (i < len) {
    // Block comment
    if (src[i] === '/' && src[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < len - 1) {
        if (src[i] === '*' && src[i + 1] === '/') {
          i += 2;
          break;
        }
        result += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      // If we didn't find the close, pad to EOF with spaces (malformed, but safe)
      while (start + (i - start) > result.length) result += ' ';
      continue;
    }

    // Line comment
    if (src[i] === '/' && src[i + 1] === '/') {
      const start = i;
      i += 2;
      while (i < len && src[i] !== '\n') {
        result += ' ';
        i++;
      }
      // Preserve the newline
      if (i < len && src[i] === '\n') {
        result += '\n';
        i++;
      }
      continue;
    }

    result += src[i];
    i++;
  }

  return result;
}

function hits(pattern: RegExp, files: string[]): Hit[] {
  const result: Hit[] = [];

  for (const file of files) {
    const fullPath = path.join(ROOT, file);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const stripped = stripComments(content);

    const lines = content.split('\n');
    const strippedLines = stripped.split('\n');

    for (let lineNum = 0; lineNum < strippedLines.length; lineNum++) {
      const strippedLine = strippedLines[lineNum];
      if (pattern.test(strippedLine)) {
        result.push({
          file,
          line: lineNum + 1,
          text: lines[lineNum].trim(),
        });
      }
    }
  }

  return result;
}

// ============================================================================
// Assertion helper: EXEMPT + PENDING exact-set model
// ============================================================================

function normalizeFileForComparison(file: string): string {
  return file.replace(/\\/g, '/');
}

function findMissingFromList(
  actual: Hit[],
  expected: Array<{ file: string; line?: number; match: string }>,
): Hit[] {
  return actual.filter((hit) => {
    return !expected.some((exp) => {
      const expFile = normalizeFileForComparison(exp.file);
      const hitFile = normalizeFileForComparison(hit.file);
      return (
        hitFile === expFile &&
        (exp.line === undefined || hit.line === exp.line) &&
        hit.text.includes(exp.match)
      );
    });
  });
}

function findStaleFromList(
  expected: Array<{ file: string; line?: number; match: string }>,
  actual: Hit[],
): Array<{ file: string; line?: number; match: string }> {
  return expected.filter((exp) => {
    return !actual.some((hit) => {
      const expFile = normalizeFileForComparison(exp.file);
      const hitFile = normalizeFileForComparison(hit.file);
      return (
        hitFile === expFile &&
        (exp.line === undefined || hit.line === exp.line) &&
        hit.text.includes(exp.match)
      );
    });
  });
}

function fail(
  invId: string,
  decisionId: string,
  title: string,
  why: string,
  newHits: Hit[],
  staleEntries: Array<{ file: string; line?: number; match: string }>,
): string {
  const lines: string[] = [];

  if (newHits.length > 0) {
    lines.push(`[${invId} / decision ${decisionId}] ${title}`);
    for (const hit of newHits) {
      lines.push(`  ${hit.file}:${hit.line}`);
      lines.push(`    ${hit.text}`);
    }
    lines.push(`  WHY: ${why}`);
  }

  if (staleEntries.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`[${invId}] STALE PENDING entries (fix has landed):`);
    for (const entry of staleEntries) {
      const loc = entry.line ? `:${entry.line}` : '';
      lines.push(`  ${entry.file}${loc} — delete this PENDING entry`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Matcher unit tests (prove red-before-green)
// ============================================================================

describe('invariant matcher unit tests', () => {
  const ROLE = 'EPIC|MISSION|LAND';
  // Match: /^\s*\[EPIC\]/i regex literal form with escaped brackets
  const RE_LITERAL = /\/[^/\n]*\\\[(?:EPIC|MISSION|LAND)\\\]/;
  // Match: .startsWith('[EPIC') or .includes("[MISSION") or === '[LAND' (unescaped, in string literals)
  const RE_STRCMP = /(?:\.(?:startsWith|includes|test)\s*\(|===\s*)\s*['"`]\s*\[(?:EPIC|MISSION|LAND)/;

  test('inv1 matcher catches friction-triage.ts isEpicTitle as it stood before [kind D]', () => {
    const code = `const isEpicTitle = (t: string | null | undefined) => /^\\s*\\[EPIC\\]/i.test(t ?? '');`;
    const stripped = stripComments(code);
    expect(RE_LITERAL.test(stripped)).toBe(true);
  });

  test('inv1 matcher catches claimability.ts isEpicTitle', () => {
    const code = `export const isEpicTitle = (title: string | null | undefined): boolean =>
  /^\\s*\\[EPIC\\]/i.test(title ?? '');`;
    const stripped = stripComments(code);
    expect(RE_LITERAL.test(stripped)).toBe(true);
  });

  test('inv1 matcher ignores MCP tool description string', () => {
    const code = `  description: 'Title auto-prefixed [MISSION].',`;
    const stripped = stripComments(code);
    expect(RE_LITERAL.test(stripped)).toBe(false);
    expect(RE_STRCMP.test(stripped)).toBe(false);
  });

  test('inv1 matcher ignores INBOX_EPIC_TITLE identity check', () => {
    const code = `  !!t && isEpicTitle(t.title) && t.title.trim() === INBOX_EPIC_TITLE;`;
    const stripped = stripComments(code);
    // This line has .includes and trim, but no role marker in a string immediately after
    expect(RE_STRCMP.test(stripped)).toBe(false);
  });

  test('inv3 matcher catches git add -A', () => {
    const code = "'STEP 4: run_bash `git add -A && git commit -m \"feat: <summary>\"`.','";
    const stripped = stripComments(code);
    const pattern = /git\s+add\s+(?:-A\b|\.(?:\s|$|["'`]))/;
    expect(pattern.test(stripped)).toBe(true);
  });

  test('inv3 matcher catches git add .', () => {
    const code = `git add . && git commit`;
    const stripped = stripComments(code);
    const pattern = /git\s+add\s+(?:-A\b|\.(?:\s|$|["'`]))/;
    expect(pattern.test(stripped)).toBe(true);
  });

  test('inv3 matcher ignores staged path like git add src/foo.ts', () => {
    const code = `git add src/foo.ts`;
    const stripped = stripComments(code);
    const pattern = /git\s+add\s+(?:-A\b|\.(?:\s|$|["'`]))/;
    expect(pattern.test(stripped)).toBe(false);
  });

  test('inv4 matcher ignores [GATE] prefix', () => {
    const code = '  const title = `[GATE]`;';
    const stripped = stripComments(code);
    const pattern = /(?:\w*[Tt]itle\s*=|\.title\s*=)[^;\n]*(?:\[(?:EPIC|MISSION|LAND)\]|(?:MISSION|EPIC|LAND)_TITLE_PREFIX)/;
    expect(pattern.test(stripped)).toBe(false);
  });

  test('inv4 matcher catches MISSION_TITLE_PREFIX interpolation', () => {
    const pattern = /(?:\w*[Tt]itle\s*[:=]|\.title\s*=)[^;\n]*(?:\[(?:EPIC|MISSION|LAND)\]|(?:MISSION|EPIC|LAND)_TITLE_PREFIX)/;
    const fullCode = 'const missionTitle = `${MISSION_TITLE_PREFIX} ${title}`;';
    expect(pattern.test(fullCode)).toBe(true);
  });
});

// ============================================================================
// The Four Invariants
// ============================================================================

describe('project standing invariants', () => {
  test('INV-1: NO ROLE DECISION FROM A TITLE (decision ea83ac9f)', () => {
    // Match: /^\s*\[EPIC\]/i regex literal form (escaped brackets) OR string comparisons
    // Two patterns: (a) regex literal with escaped brackets, (b) string comparison
    const pattern = /\/[^/\n]*\\\[(?:EPIC|MISSION|LAND)\\\]|(?:\.(?:startsWith|includes|test)\s*\(|===\s*)\s*['"`]\s*\[(?:EPIC|MISSION|LAND)/;
    const allFiles = sourceFiles(['src', 'ui/src']);
    const srcFiles = allFiles.filter((f) => f.startsWith('src/'));
    const allHits = hits(pattern, srcFiles);

    const EXEMPT: ExemptEntry[] = [
      {
        file: 'src/services/claimability.ts',
        match: 'INBOX_EPIC_TITLE',
        reason: 'Identity check on a named singleton, explicitly permitted',
      },
    ];

    const PENDING: PendingEntry[] = [
      {
        file: 'src/mcp/tools/session-todos.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: '\\[EPIC\\]',
      },
      {
        file: 'src/services/claimability.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: '\\[EPIC\\]',
      },
      {
        file: 'src/services/claimability.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: '\\[MISSION\\]',
      },
      {
        file: 'src/services/coordinator-live.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: '\\[EPIC\\]',
      },
      {
        file: 'src/services/friction-triage.ts',
        owner: '8a570045 / 447826e8 ([kind D])',
        match: '\\[EPIC\\]',
      },
      {
        file: 'src/services/invariant-check.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: '\\[EPIC\\]',
      },
      {
        file: 'src/services/invariant-check.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: '\\[LAND\\]',
      },
      {
        file: 'src/services/mission-loop.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: '\\[MISSION\\]',
      },
      {
        file: 'src/services/session-notification-router.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: "startsWith('[EPIC]')",
      },
      {
        file: 'src/services/todo-store.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: '\\[EPIC\\]',
      },
      {
        file: 'src/services/todo-store.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: '\\[MISSION\\]',
      },
      {
        file: 'src/services/todo-store.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: '\\[MISSION\\]',
      },
    ];

    const exemptHits = allHits.filter((hit) =>
      EXEMPT.some((ex) => normalizeFileForComparison(hit.file) === normalizeFileForComparison(ex.file) && hit.text.includes(ex.match))
    );

    const nonExemptHits = allHits.filter(
      (hit) =>
        !exemptHits.includes(hit) &&
        !PENDING.some(
          (p) =>
            normalizeFileForComparison(hit.file) === normalizeFileForComparison(p.file) &&
            hit.text.includes(p.match),
        ),
    );

    const staleEntries = findStaleFromList(PENDING, allHits);

    const message = fail(
      'INV-1',
      'ea83ac9f',
      'role decided from a title',
      'a node\'s role is data, not a substring of its label. A per-file review cannot see this convention; that is why it is a standing test.',
      nonExemptHits,
      staleEntries,
    );

    expect(nonExemptHits.length === 0 && staleEntries.length === 0, message).toBe(true);
  });

  test('INV-2: NO STRUCTURAL ROLE INFERENCE (constraint 373a2d52)', () => {
    const pattern = /childrenByParent\s*\.\s*has\s*\(|\bparentId\s*(?:===|==)\s*null\b/;
    const allFiles = sourceFiles(['ui/src']);
    const allHits = hits(pattern, allFiles);

    const PENDING: PendingEntry[] = [
      {
        file: 'ui/src/components/supervisor/bridge/BridgeDashboard.tsx',
        owner: '82f1011a ([kind E])',
        match: 'childrenByParent',
      },
      {
        file: 'ui/src/components/supervisor/bridge/fleet/useFleetGraph.ts',
        owner: '82f1011a ([kind E])',
        match: 'parentId == null',
      },
    ];

    const nonExemptHits = allHits.filter(
      (hit) =>
        !PENDING.some(
          (p) =>
            normalizeFileForComparison(hit.file) === normalizeFileForComparison(p.file) &&
            hit.text.includes(p.match),
        ),
    );

    const staleEntries = findStaleFromList(PENDING, allHits);

    const message = fail(
      'INV-2',
      '373a2d52',
      'structural role inference in UI',
      '`parentId === null` now means EPIC **or** MISSION; and a split LEAF has children. Neither implies "epic". Read the role from the node.',
      nonExemptHits,
      staleEntries,
    );

    expect(nonExemptHits.length === 0 && staleEntries.length === 0, message).toBe(true);
  });

  test('INV-3: NO `git add -A` / `git add .` ANYWHERE IN src/ (G12, a42343ec)', () => {
    const pattern = /git\s+add\s+(?:-A\b|\.(?:\s|$|["'`]))/;
    const allFiles = sourceFiles(['src']);
    // Exclude __tests__ for this scan (they are in src/ but we want product code + prompts only)
    const srcFiles = allFiles.filter((f) => !f.includes('__tests__'));
    const allHits = hits(pattern, srcFiles);

    const PENDING: PendingEntry[] = [
      {
        file: 'src/agent/adapters/grok-own.ts',
        owner: 'a42343ec (G12)',
        match: 'git add -A',
      },
      {
        file: 'src/agent/worker-core/orchestrator.ts',
        owner: 'a42343ec (G12)',
        match: 'git add -A',
      },
      {
        file: 'src/agent/worker-core/orchestrator.ts',
        owner: 'a42343ec (G12)',
        match: 'git add -A',
      },
    ];

    const nonExemptHits = allHits.filter(
      (hit) =>
        !PENDING.some(
          (p) =>
            normalizeFileForComparison(hit.file) === normalizeFileForComparison(p.file) &&
            hit.text.includes(p.match),
        ),
    );

    const staleEntries = findStaleFromList(PENDING, allHits);

    const message = fail(
      'INV-3',
      'a42343ec',
      'naked `git add -A` / `git add .` in prompt strings',
      'the ban lived in six leaf specs and was violated four times because the SYSTEM issued it. Stage explicit paths.',
      nonExemptHits,
      staleEntries,
    );

    expect(nonExemptHits.length === 0 && staleEntries.length === 0, message).toBe(true);
  });

  test('INV-4: NO ROLE PREFIX WRITTEN INTO A STORED TITLE (decision ea83ac9f)', () => {
    // Match: code assignments that write a role marker into a title variable
    // Pattern: variable/property with 'title' in name, then =, then marker in same line
    // Catches: title = [MISSION], missionTitle = `${MISSION_TITLE_PREFIX}`, patch.title = ...[EPIC]...
    // Ignores: JSON field definitions (title: ...), description strings, const declarations that just define the prefix
    const pattern = /(?:\w*[Tt]itle\s*=|\.title\s*=)[^;\n]*(?:\[(?:EPIC|MISSION|LAND)\]|(?:MISSION|EPIC|LAND)_TITLE_PREFIX)/;
    const allFiles = sourceFiles(['src', 'ui/src']);
    const srcFiles = allFiles.filter((f) => f.startsWith('src/'));
    const allHits = hits(pattern, srcFiles);

    const PENDING: PendingEntry[] = [
      {
        file: 'src/mcp/mission-tools.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: 'MISSION_TITLE_PREFIX',
      },
      {
        file: 'src/mcp/mission-tools.ts',
        owner: 'ea83ac9f (kind-column migration)',
        match: 'MISSION_TITLE_PREFIX',
      },
    ];

    const nonExemptHits = allHits.filter(
      (hit) =>
        !PENDING.some(
          (p) =>
            normalizeFileForComparison(hit.file) === normalizeFileForComparison(p.file) &&
            hit.text.includes(p.match),
        ),
    );

    const staleEntries = findStaleFromList(PENDING, allHits);

    const message = fail(
      'INV-4',
      'ea83ac9f',
      'role prefix written into a stored title',
      'a node\'s role must be stored separately from its title. The migration to the `kind` column will remove these prefixes.',
      nonExemptHits,
      staleEntries,
    );

    expect(nonExemptHits.length === 0 && staleEntries.length === 0, message).toBe(true);
  });
});
