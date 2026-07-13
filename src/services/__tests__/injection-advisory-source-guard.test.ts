/**
 * Injection-advisory source guard: the four gate files must reference ZERO injection-payload
 * symbols/markers. Gates verify the real tree, never consume an advisory payload string.
 * This test FAILS if any gate ever imports or references a payload symbol or marker from
 * prompt-injection.ts, project-digest.ts, or review-citations.ts.
 *
 * Design ref: project-digest-injection-seam-design §5 (safety, non-negotiable).
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The four gate files that must remain clean of injection-payload symbols/markers. */
const GATE_FILES = [
  'leaf-gate.ts',
  'epic-land-gate.ts',
  'steward-proof.ts',
  'land-authority.ts',
];

/** Payload symbols and markers that must NOT appear in any gate file. */
const FORBIDDEN = [
  // Symbols exported from prompt-injection.ts, project-digest.ts, review-citations.ts
  { label: 'composeInjectedContext', needle: 'composeInjectedContext' },
  { label: 'generateProjectDigest', needle: 'generateProjectDigest' },
  { label: 'regenerateProjectDigest', needle: 'regenerateProjectDigest' },
  { label: 'readProjectDigest', needle: 'readProjectDigest' },
  { label: 'checkConstraintCitations', needle: 'checkConstraintCitations' },
  // Markers defined in prompt-injection.ts (lines 34, 102, 110, 120)
  { label: 'advisory marker', needle: 'advisory — verify against the tree' },
  { label: 'PREVIOUS ATTEMPT FAILED marker', needle: 'PREVIOUS ATTEMPT FAILED' },
  { label: 'ACTIVE CONSTRAINTS marker', needle: 'ACTIVE CONSTRAINTS' },
  { label: 'PROJECT DIGEST marker', needle: 'PROJECT DIGEST' },
];

describe('injection-advisory-source-guard', () => {
  it('each gate file references zero payload symbols/markers', () => {
    const gateDir = join(import.meta.dir, '..');

    for (const fileName of GATE_FILES) {
      const filePath = join(gateDir, fileName);
      const content = readFileSync(filePath, 'utf-8');

      for (const { label, needle } of FORBIDDEN) {
        const found = content.includes(needle);
        expect(found).toBe(false);
        if (found) {
          throw new Error(`${fileName} contains ${label} — payload symbols must not leak into gates`);
        }
      }
    }
  });

  it('self-check: detector correctly identifies payload symbols in synthetic gate-source', () => {
    // Synthetic gate-source string embedding a payload symbol.
    const syntheticGateWithPayload = `
      import { composeInjectedContext } from './prompt-injection';

      export function mockGate(input: unknown): boolean {
        return true;
      }
    `;

    // Verify the detector catches the symbol.
    expect(syntheticGateWithPayload.includes('composeInjectedContext')).toBe(true);

    // Verify it would also catch markers.
    const syntheticWithMarker = 'const msg = "advisory — verify against the tree";';
    expect(syntheticWithMarker.includes('advisory — verify against the tree')).toBe(true);
  });
});
