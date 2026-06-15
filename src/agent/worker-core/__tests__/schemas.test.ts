import { describe, it, expect } from 'vitest';
import {
  SplitProposalSchema,
  ResearchFindingsSchema,
  VerifyVerdictSchema,
  ReviewVerdictSchema,
} from '../schemas';

describe('worker-core schemas', () => {
  it('SplitProposal defaults subtasks to []', () => {
    const p = SplitProposalSchema.parse({ oversized: false });
    expect(p.subtasks).toEqual([]);
  });

  it('SplitProposal parses drafted subtasks', () => {
    const p = SplitProposalSchema.parse({
      oversized: true,
      reason: 'too wide',
      subtasks: [{ title: 'a', files: ['x.ts'] }, { title: 'b', files: [], type: 'ui' }],
    });
    expect(p.subtasks).toHaveLength(2);
    expect(p.subtasks[0].files).toEqual(['x.ts']);
  });

  it('ResearchFindings requires plan + behavioral; defaults filesToEdit', () => {
    const r = ResearchFindingsSchema.parse({ plan: 'do x', behavioral: true });
    expect(r.filesToEdit).toEqual([]);
    expect(() => ResearchFindingsSchema.parse({ behavioral: true })).toThrow();
  });

  it('VerifyVerdict defaults the failure arrays', () => {
    const v = VerifyVerdictSchema.parse({ pass: true });
    expect(v.failingChecks).toEqual([]);
    expect(v.errorSignatures).toEqual([]);
  });

  it('ReviewVerdict defaults gaps', () => {
    expect(ReviewVerdictSchema.parse({ complete: true }).gaps).toEqual([]);
  });

  it('rejects a malformed verdict (so the host can fail-safe to escalation)', () => {
    expect(() => VerifyVerdictSchema.parse({ pass: 'yes' })).toThrow();
  });
});
