import { describe, it, expect, beforeAll } from 'bun:test';
import path from 'node:path';
import {
  loadSrcCorpus,
  findLandednessProducers,
  findTerminalPrefixProducers,
  findContainerCloseProducers,
  findLandRecordCaptureProducers,
  type AuditCorpus,
  type AuditResult,
} from '../single-producer-audit';

// Exclude single-producer-audit.ts itself from call-site scans (the file mentions detector names in regex literals)
const CALL_SITE_SCAN_EXCLUSIONS = new Set(['src/services/single-producer-audit.ts']);

let corpus: AuditCorpus;

beforeAll(() => {
  const repoRoot = path.resolve(import.meta.dir, '../../..');
  corpus = loadSrcCorpus(repoRoot);
});

// Convert AuditResult hits to "file:line" string array
function locations(result: AuditResult): string[] {
  return result.hits.map((h) => `${h.file}:${h.line}`);
}

// Find all call sites of a symbol by searching for the pattern \bSYMBOL\s*\(
// Skip declaration lines, comment lines, and exclusion set
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

describe('single-producer-audit', () => {
  it('corpus sanity: contains epic-landedness.ts and excludes test files', () => {
    expect(corpus.has('src/services/epic-landedness.ts')).toBe(true);
    expect(corpus.has('src/services/__tests__/single-producer-audit.test.ts')).toBe(false);
  });

  describe('landedness producers', () => {
    it('finds exactly 2 hits at specified lines in epic-landedness.ts', () => {
      const result = findLandednessProducers(corpus);
      expect(locations(result)).toEqual([
        'src/services/epic-landedness.ts:43',
        'src/services/epic-landedness.ts:55',
      ]);
    });

    it('has exactly one file in landedness results', () => {
      const result = findLandednessProducers(corpus);
      const files = [...new Set(result.hits.map((h) => h.file))].sort();
      expect(files).toEqual(['src/services/epic-landedness.ts']);
    });
  });

  describe('terminal prefix producers', () => {
    it('finds exactly 1 hit in mission-store.ts', () => {
      const result = findTerminalPrefixProducers(corpus);
      expect(result.hits.length).toBe(1);
      expect(result.hits[0].file).toBe('src/services/mission-store.ts');
    });

    it('hit enclosing function is deriveTerminalMissionPrefix', () => {
      const result = findTerminalPrefixProducers(corpus);
      const hit = result.hits[0];
      const enclosing = enclosingFunction(corpus, hit.file, hit.line);
      expect(enclosing).toBe('deriveTerminalMissionPrefix');
    });

    it('has exactly one file in terminal prefix results', () => {
      const result = findTerminalPrefixProducers(corpus);
      const files = [...new Set(result.hits.map((h) => h.file))].sort();
      expect(files).toEqual(['src/services/mission-store.ts']);
    });

    it('does not include isMissionTerminal in hits', () => {
      const result = findTerminalPrefixProducers(corpus);
      const hasIsMissionTerminal = result.hits.some((h) =>
        h.text.includes('isMissionTerminal')
      );
      expect(hasIsMissionTerminal).toBe(false);
    });

    it('does not include mission-store.ts:49 (isMissionTerminal declaration)', () => {
      const result = findTerminalPrefixProducers(corpus);
      const locs = locations(result);
      expect(locs).toEqual(['src/services/mission-store.ts:1255']);
      expect(locs.includes('src/services/mission-store.ts:49')).toBe(false);
    });

    it('has exactly 2 call sites of deriveTerminalMissionPrefix', () => {
      const sites = callSites(corpus, 'deriveTerminalMissionPrefix', {
        excludeFiles: CALL_SITE_SCAN_EXCLUSIONS,
      });
      expect(sites.length).toBe(2);
      // Verify both are in mission-store.ts
      expect(sites.every((s) => s.startsWith('src/services/mission-store.ts:'))).toBe(true);
    });

    it('call sites of deriveTerminalMissionPrefix are in deriveMissionStatus and deriveCheapMissionStatus', () => {
      const sites = callSites(corpus, 'deriveTerminalMissionPrefix', {
        excludeFiles: CALL_SITE_SCAN_EXCLUSIONS,
      });
      const enclosings = sites.map((site) => {
        const [filePath, lineStr] = site.split(':');
        const line = parseInt(lineStr, 10);
        return enclosingFunction(corpus, filePath, line);
      });
      expect(enclosings.sort()).toEqual(['deriveCheapMissionStatus', 'deriveMissionStatus']);
    });
  });

  describe('container close producers', () => {
    it('finds exactly 1 hit in todo-store.ts', () => {
      const result = findContainerCloseProducers(corpus);
      expect(result.hits.length).toBe(1);
      expect(result.hits[0].file).toBe('src/services/todo-store.ts');
    });

    it('hit enclosing function is closeEpicIfChildrenSettled', () => {
      const result = findContainerCloseProducers(corpus);
      const hit = result.hits[0];
      const enclosing = enclosingFunction(corpus, hit.file, hit.line);
      expect(enclosing).toBe('closeEpicIfChildrenSettled');
    });

    it('has exactly one file in container close results', () => {
      const result = findContainerCloseProducers(corpus);
      const files = [...new Set(result.hits.map((h) => h.file))].sort();
      expect(files).toEqual(['src/services/todo-store.ts']);
    });

    it('has exactly 3 call sites of closeEpicIfChildrenSettled', () => {
      const sites = callSites(corpus, 'closeEpicIfChildrenSettled', {
        excludeFiles: CALL_SITE_SCAN_EXCLUSIONS,
      });
      expect(sites.length).toBe(3);
      expect(sites.every((s) => s.startsWith('src/services/todo-store.ts:'))).toBe(true);
    });

    it('does not include specified non-hit locations', () => {
      const result = findContainerCloseProducers(corpus);
      const locs = locations(result);
      const nonHits = [
        'src/services/todo-store.ts:1450',
        'src/services/todo-store.ts:2547',
        'src/services/todo-store.ts:2645',
        'src/services/claimability.ts:247',
        'src/services/claimability.ts:248',
      ];
      for (const nonHit of nonHits) {
        expect(locs.includes(nonHit)).toBe(false);
      }
    });
  });

  describe('land record capture producers', () => {
    it('finds exactly 1 hit in epic-land-record-store.ts', () => {
      const result = findLandRecordCaptureProducers(corpus);
      expect(result.hits.length).toBe(1);
      expect(result.hits[0].file).toBe('src/services/epic-land-record-store.ts');
    });

    it('has exactly one file in land record capture results', () => {
      const result = findLandRecordCaptureProducers(corpus);
      const files = [...new Set(result.hits.map((h) => h.file))].sort();
      expect(files).toEqual(['src/services/epic-land-record-store.ts']);
    });

    it('has exactly 2 call sites of captureLandCycleFields in two distinct files', () => {
      const sites = callSites(corpus, 'captureLandCycleFields', {
        excludeFiles: CALL_SITE_SCAN_EXCLUSIONS,
      });
      expect(sites.length).toBe(2);
      const files = [...new Set(sites.map((s) => s.split(':')[0]))].sort();
      expect(files).toEqual([
        'src/services/coordinator-land.ts',
        'src/services/coordinator-live.ts',
      ]);
    });
  });
});
