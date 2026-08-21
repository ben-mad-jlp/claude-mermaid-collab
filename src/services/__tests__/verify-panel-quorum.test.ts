import { describe, it, expect } from 'bun:test';
import { joinPanelVerdicts, type PanelVerdict } from '../criterion-verify-panel';

describe('joinPanelVerdicts quorum reporting', () => {
  it('(1) a panel result built from one lens verdict carries lensCount 1 and quorum provisional', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: 'found' },
    ];
    const join = joinPanelVerdicts(verdicts);
    expect(join.lensCount).toBe(1);
    expect(join.quorum).toBe('provisional');
    expect(join.met).toBe(true);
  });

  it('(2) a panel result built from two agreeing lens verdicts carries lensCount 2 and quorum majority', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: 'found' },
      { lens: 'holds-at-head', met: true, reason: 'still holds' },
    ];
    const join = joinPanelVerdicts(verdicts);
    expect(join.lensCount).toBe(2);
    expect(join.quorum).toBe('majority');
  });

  it('excludes indeterminate verdicts from lensCount (derives from effective, not verdicts)', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: 'found' },
      { lens: 'holds-at-head', met: true, reason: 'infra fault', indeterminate: true },
    ];
    const join = joinPanelVerdicts(verdicts);
    expect(join.lensCount).toBe(1);
    expect(join.quorum).toBe('provisional');
  });
});
