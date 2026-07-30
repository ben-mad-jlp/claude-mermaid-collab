/**
 * Fingerprints (serveFp, passFp, lastConductorKey, lastConductorSelfKey) are OPAQUE identity
 * tokens — they are compared whole (see conductor-pass.ts `lastKey === fp`), never parsed or
 * sliced to recover an embedded counter. The rejected shape — encoding a counter INTO the
 * fingerprint string (`${serveFp}|fail:N`) and recovering it via .startsWith/.slice — was
 * deleted in favor of deriving the fail-retry count from journal rows
 * (countConsecutiveFailedPasses, conductor-pass-journal.ts:227). If this test goes red, the fix
 * is to derive the counter from journal rows again — never to re-encode it into a fingerprint
 * string.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SERVICES_DIR = join(import.meta.dir, '..');

function scannedFiles() {
  return readdirSync(SERVICES_DIR).filter((name) => name.endsWith('.ts'));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const SLICE_RE = /\b(lastConductorKey|lastConductorSelfKey|serveFp|passFp|failPrefix|fp)\.(startsWith|slice)\(/;

function collectOffenders(predicate: (line: string) => boolean): string[] {
  const offenders: string[] = [];
  for (const fileName of scannedFiles()) {
    const raw = readFileSync(join(SERVICES_DIR, fileName), 'utf-8');
    const content = stripComments(raw);
    const lines = content.split('\n');
    lines.forEach((line: string, idx: number) => {
      if (predicate(line)) {
        offenders.push(`${fileName}:${idx + 1}`);
      }
    });
  }
  return offenders;
}

describe('conductor-fingerprint-parse-guard', () => {
  it('zero occurrences of the literal `|fail:` string-encoded counter shape across src/services/*.ts', () => {
    const offenders = collectOffenders((line) => line.includes('|fail:'));
    expect(offenders).toEqual([]);
  });

  it('zero .startsWith(/.slice( calls on a fingerprint-named value across src/services/*.ts', () => {
    const offenders = collectOffenders((line) => SLICE_RE.test(line));
    expect(offenders).toEqual([]);
  });

  it('zero surviving references to the retired failPrefix identifier across src/services/*.ts', () => {
    const offenders = collectOffenders((line) => line.includes('failPrefix'));
    expect(offenders).toEqual([]);
  });

  it('self-check: the detector matches a synthetic fingerprint-parse sample (non-vacuous)', () => {
    const sampleA = 'const failPrefix = `${serveFp}|fail:`;';
    const sampleB = 'failPrefix.slice(0, 8)';

    expect(sampleA.includes('|fail:')).toBe(true);
    expect(sampleA.includes('failPrefix')).toBe(true);
    expect(SLICE_RE.test(sampleB)).toBe(true);
    expect(sampleB.includes('failPrefix')).toBe(true);
  });
});
