import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

describe('workRequestVocabGate', () => {
  it('VOCABULARY.md uses the canonical term work request at least three times', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const vocabPath = path.resolve(dir, '../../../docs/VOCABULARY.md');
    const content = fs.readFileSync(vocabPath, 'utf-8');

    const matches = content.match(/work request/gi);
    const count = matches ? matches.length : 0;

    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('VOCABULARY.md confines triage to the retired-terms denylist row', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const vocabPath = path.resolve(dir, '../../../docs/VOCABULARY.md');
    const content = fs.readFileSync(vocabPath, 'utf-8');

    const lines = content.split('\n');
    const triageLines: { index: number; line: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (/triage/i.test(lines[i])) {
        triageLines.push({ index: i, line: lines[i] });
      }
    }

    expect(triageLines).toHaveLength(1);
    expect(triageLines[0].line).toMatch(/^\s*\|\s*"triage"\s*\(as a work-request surface\)/);
  });
});
