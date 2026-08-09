// Regression test for partitionLandedLeftovers single-producer audit
import { describe, test, expect, beforeAll } from 'bun:test';
import path from 'node:path';
import {
  loadSrcCorpus,
  type AuditCorpus,
} from '../single-producer-audit';
import { partitionLandedLeftovers, type Todo, type ClaimStruct } from '../todo-store';

let corpus: AuditCorpus;

beforeAll(() => {
  const repoRoot = path.resolve(import.meta.dir, '../../..');
  corpus = loadSrcCorpus(repoRoot);
});

// Find the enclosing function name for a given file and line number
function enclosingFunction(corpus: AuditCorpus, file: string, line: number): string {
  const text = corpus.get(file);
  if (!text) return '';

  const lines = text.split('\n');
  const declPattern = /^\s*export\s+(?:async\s+)?function\s+(\w+)\s*\(/;

  // Scan backwards from the target line to find the nearest function declaration
  for (let i = line - 1; i >= 0; i--) {
    const match = declPattern.exec(lines[i]);
    if (match) {
      return match[1];
    }
  }

  return '';
}

// Find all call sites of a symbol by searching for the pattern \bSYMBOL\s*\(
function callSites(
  corpus: AuditCorpus,
  symbol: string,
  opts?: { excludeFiles?: Set<string> }
): string[] {
  const excludeFiles = opts?.excludeFiles ?? new Set<string>();
  const callPattern = new RegExp(`\\b${symbol}\\s*\\(`);
  const declPattern = new RegExp(`^\\s*export\\s+(?:async\\s+)?function\\s+${symbol}\\s*\\(`);
  const sites: string[] = [];

  for (const file of [...corpus.keys()].sort()) {
    if (excludeFiles.has(file)) {
      continue;
    }

    const text = corpus.get(file)!;
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip declaration lines
      if (declPattern.test(line)) {
        continue;
      }

      // Skip comment lines
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        continue;
      }

      // Check for call site
      if (callPattern.test(line)) {
        sites.push(`${file}:${i + 1}`);
      }
    }
  }

  return sites.sort();
}

describe('landed-leftover-single-producer', () => {
  describe('source-guard', () => {
    test('survivor predicate appears in exactly one function (partitionLandedLeftovers)', () => {
      // Search for the survivor predicate: a line with both "claim" null-check and "supersedes" check
      // in the same enclosing function
      const hits: Array<{ file: string; line: number; fn: string }> = [];
      const predicatePattern = /c\.claim\s*!=\s*null|supersedes\s*===\s*c\.id/;

      for (const file of [...corpus.keys()].sort()) {
        const text = corpus.get(file)!;
        const lines = text.split('\n');

        // Find all lines matching the pattern
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (predicatePattern.test(line)) {
            const fn = enclosingFunction(corpus, file, i + 1);
            if (fn) {
              const key = `${file}:${fn}`;
              if (!hits.some((h) => h.file === file && h.fn === fn)) {
                hits.push({ file, line: i + 1, fn });
              }
            }
          }
        }
      }

      // Filter to functions that have BOTH patterns (indicating the full survivor check)
      const survivorFunctions = new Map<string, string[]>();
      for (const file of [...corpus.keys()].sort()) {
        const text = corpus.get(file)!;
        const lines = text.split('\n');
        const declPattern = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const match = declPattern.exec(line);

          if (match) {
            const functionName = match[1];
            // Collect bounded window (next '}' at column 0)
            let windowEnd = Math.min(i + 200, lines.length);
            for (let j = i + 1; j < Math.min(i + 200, lines.length); j++) {
              if (lines[j] === '}') {
                windowEnd = j;
                break;
              }
            }

            const window = lines.slice(i, windowEnd + 1).join('\n');

            // Check for both patterns in the same function
            const hasClaimCheck = /c\.claim\s*!=\s*null/.test(window);
            const hasSupersededCheck = /supersedes\s*===\s*c\.id/.test(window);

            if (hasClaimCheck && hasSupersededCheck) {
              const key = `${file}:${functionName}`;
              if (!survivorFunctions.has(key)) {
                survivorFunctions.set(key, []);
              }
            }
          }
        }
      }

      // Should be exactly one: partitionLandedLeftovers in todo-store.ts
      expect(survivorFunctions.size).toBe(1);
      expect([...survivorFunctions.keys()][0]).toMatch(/src\/services\/todo-store\.ts:partitionLandedLeftovers/);
    });

    test('call sites of partitionLandedLeftovers live only in sweepEpicRollups and terminalizeLandedEpics', () => {
      const sites = callSites(corpus, 'partitionLandedLeftovers');

      // Extract function names
      const functions = sites.map((site) => {
        const [file, lineStr] = site.split(':');
        const line = parseInt(lineStr, 10);
        return enclosingFunction(corpus, file, line);
      });

      const uniqueFunctions = new Set(functions);
      expect(uniqueFunctions).toEqual(new Set(['sweepEpicRollups', 'terminalizeLandedEpics']));
    });
  });

  describe('direct unit tests', () => {
    // Helper to build a minimal Todo fixture
    function makeTodo(overrides: Partial<Todo>): Todo {
      return {
        id: 'test-todo-1',
        ownerSession: 's1',
        assigneeSession: null,
        assigneeKind: 'agent',
        title: 'Test Todo',
        description: null,
        status: 'planned',
        completed: false,
        priority: null,
        dueDate: null,
        parentId: null,
        dependsOn: [],
        order: 0,
        link: null,
        createdAt: '2026-08-08T00:00:00Z',
        updatedAt: '2026-08-08T00:00:00Z',
        completedAt: null,
        asanaGid: null,
        sessionName: null,
        executedBySession: null,
        blueprintId: null,
        type: null,
        targetProject: null,
        kind: 'leaf',
        acceptanceStatus: null,
        claimedBy: null,
        claimToken: null,
        claimedAt: null,
        claimLeaseMs: null,
        claim: null,
        approvedAt: null,
        approvedBy: null,
        heldAt: null,
        heldReason: null,
        retryCount: 0,
        completedBy: null,
        objectRef: null,
        servesCriterionId: null,
        servesCriterionIds: [],
        decisionRef: null,
        claimProbe: null,
        inheritedBlueprintFrom: null,
        inheritedFiles: [],
        declaredFiles: [],
        isBucket: false,
        supersedes: null,
        ...overrides,
      };
    }

    test('unclaimed non-terminal child is a survivor', () => {
      const child = makeTodo({ id: 'child-1', status: 'planned', claim: null });
      const sibling = makeTodo({ id: 'sibling-1', status: 'done' });
      const children = [sibling];
      const leftover = [child];

      const { survivors, retirable } = partitionLandedLeftovers(children, leftover);

      expect(survivors).toContain(child);
      expect(survivors.length).toBe(1);
      expect(retirable.length).toBe(0);
    });

    test('claimed child is not a survivor', () => {
      const claim: ClaimStruct = { by: 'worker', token: 'tok', at: '2026-08-08T00:00:00Z', leaseMs: 3600000 };
      const child = makeTodo({
        id: 'child-1',
        status: 'planned',
        claim,
      });
      const sibling = makeTodo({ id: 'sibling-1', status: 'done' });
      const children = [sibling];
      const leftover = [child];

      const { survivors, retirable } = partitionLandedLeftovers(children, leftover);

      expect(survivors.length).toBe(0);
      expect(retirable).toContain(child);
    });

    test('done child is retirable', () => {
      const child = makeTodo({ id: 'child-1', status: 'done', claim: null });
      const sibling = makeTodo({ id: 'sibling-1', status: 'done' });
      const children = [sibling];
      const leftover = [child];

      const { survivors, retirable } = partitionLandedLeftovers(children, leftover);

      expect(survivors.length).toBe(0);
      expect(retirable).toContain(child);
    });

    test('dropped child is retirable', () => {
      const child = makeTodo({ id: 'child-1', status: 'dropped', claim: null });
      const sibling = makeTodo({ id: 'sibling-1', status: 'done' });
      const children = [sibling];
      const leftover = [child];

      const { survivors, retirable } = partitionLandedLeftovers(children, leftover);

      expect(survivors.length).toBe(0);
      expect(retirable).toContain(child);
    });

    test('child superseded by a live sibling is retirable', () => {
      const child = makeTodo({ id: 'child-1', status: 'planned', claim: null });
      const superseding = makeTodo({ id: 'superseding-1', status: 'planned', supersedes: 'child-1' });
      const children = [superseding];
      const leftover = [child];

      const { survivors, retirable } = partitionLandedLeftovers(children, leftover);

      expect(survivors.length).toBe(0);
      expect(retirable).toContain(child);
    });

    test('child superseded by a dropped sibling is a survivor', () => {
      const child = makeTodo({ id: 'child-1', status: 'planned', claim: null });
      const droppedSuperseding = makeTodo({ id: 'superseding-1', status: 'dropped', supersedes: 'child-1' });
      const children = [droppedSuperseding];
      const leftover = [child];

      const { survivors, retirable } = partitionLandedLeftovers(children, leftover);

      expect(survivors).toContain(child);
      expect(survivors.length).toBe(1);
      expect(retirable.length).toBe(0);
    });

    test('kind land child is retirable', () => {
      const child = makeTodo({ id: 'child-1', status: 'planned', kind: 'land', claim: null });
      const sibling = makeTodo({ id: 'sibling-1', status: 'done' });
      const children = [sibling];
      const leftover = [child];

      const { survivors, retirable } = partitionLandedLeftovers(children, leftover);

      expect(survivors.length).toBe(0);
      expect(retirable).toContain(child);
    });
  });
});
