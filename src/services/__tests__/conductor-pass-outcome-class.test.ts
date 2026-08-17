import { readFileSync } from 'fs';
import { describe, it, expect } from 'bun:test';
import { CONDUCTOR_PASS_OUTCOME_CLASS, classifyConductorPassOutcome } from '../conductor-pass-outcome-class.js';

describe('conductor-pass-outcome-class', () => {
  it('returns stuck for an unrecognised outcome', () => {
    expect(classifyConductorPassOutcome('legacy-reason-from-2025')).toBe('stuck');
    expect(classifyConductorPassOutcome('conducted')).toBe('quiet');
  });

  it('returns stuck for debounced when an arm is actionable', () => {
    expect(classifyConductorPassOutcome('debounced')).toBe('quiet');
    expect(classifyConductorPassOutcome('debounced', { actionableArm: true })).toBe('stuck');
  });

  it('declares the table with a satisfies clause over the full ConductorPassReason union', () => {
    // Read module source and verify satisfies clause
    const modulePath = new URL('../conductor-pass-outcome-class.ts', import.meta.url);
    const moduleSource = readFileSync(modulePath, 'utf-8');
    expect(moduleSource).toContain("satisfies Record<ConductorPassReason, 'quiet' | 'stuck'>");

    // Read supervisor-store.ts and extract ConductorPassReason union members
    const supervisorStorePath = new URL('../supervisor-store.ts', import.meta.url);
    const supervisorStoreSource = readFileSync(supervisorStorePath, 'utf-8');

    const lines = supervisorStoreSource.split('\n');
    let inUnion = false;
    let unionEndLine = -1;
    const unionLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('export type ConductorPassReason =')) {
        inUnion = true;
      }
      if (inUnion) {
        unionLines.push(line);
        if (line.trim().endsWith(';')) {
          unionEndLine = i;
          break;
        }
      }
    }

    expect(unionEndLine).toBeGreaterThan(0);

    // Extract quoted literals only from lines whose first non-space character is |
    const unionMembers = new Set<string>();
    for (const line of unionLines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('|')) {
        // Extract quoted strings from this line
        const matches = line.match(/'([a-z-]+)'/g);
        if (matches) {
          for (const match of matches) {
            const quoted = match.slice(1, -1); // Remove quotes
            unionMembers.add(quoted);
          }
        }
      }
    }

    // Verify count and membership
    expect(unionMembers.size).toBe(23);

    const tableKeys = new Set(Object.keys(CONDUCTOR_PASS_OUTCOME_CLASS));
    const sortedTableKeys = Array.from(tableKeys).sort();
    const sortedUnionMembers = Array.from(unionMembers).sort();

    expect(sortedTableKeys).toEqual(sortedUnionMembers);
  });
});
