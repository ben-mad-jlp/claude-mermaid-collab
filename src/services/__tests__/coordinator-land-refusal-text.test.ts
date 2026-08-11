import { describe, it, expect } from 'bun:test';
import { landRefusalCardText } from '../coordinator-land';

describe('landRefusalCardText', () => {
  it('includes the full branch ref, not a truncated slice', () => {
    const result = landRefusalCardText({
      epicBranch: 'collab/epic/00506b51',
      reason: 'land gate FAILED: typecheck (npx tsc --noEmit)',
      detail: 'TS2345: error in type definition',
    });

    expect(result).toContain('collab/epic/00506b51');
    expect(result).not.toMatch(/collab\/e\)/);
  });
});
