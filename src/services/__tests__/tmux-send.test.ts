/**
 * planSelectionKeystrokes — the pure keystroke plan that answers a Claude Code
 * multi-select prompt. Verified mechanics (Claude Code v2.1.185): a literal digit
 * toggles that option's checkbox in place, then `Right` opens the review/Submit tab
 * and `Enter` confirms. This test pins the plan so the load-bearing sequence can't
 * drift; the spawn execution (sendTmuxSelectionRaw) is a thin loop over this plan.
 */
import { describe, it, expect } from 'bun:test';
import { planSelectionKeystrokes, MAX_SELECTION_OPTION } from '../tmux-send.ts';

describe('planSelectionKeystrokes', () => {
  it('toggles each chosen option (literal digit) then submits via Right→Enter', () => {
    expect(planSelectionKeystrokes([2, 4])).toEqual([
      { literal: true, value: '2' },
      { literal: true, value: '4' },
      { literal: false, value: 'Right' },
      { literal: false, value: 'Enter' },
    ]);
  });

  it('sorts ascending and dedupes so the sequence is deterministic', () => {
    expect(planSelectionKeystrokes([3, 1, 3, 1])).toEqual([
      { literal: true, value: '1' },
      { literal: true, value: '3' },
      { literal: false, value: 'Right' },
      { literal: false, value: 'Enter' },
    ]);
  });

  it('handles a single selection', () => {
    expect(planSelectionKeystrokes([1])).toEqual([
      { literal: true, value: '1' },
      { literal: false, value: 'Right' },
      { literal: false, value: 'Enter' },
    ]);
  });

  it('returns null for an empty selection (caller falls back)', () => {
    expect(planSelectionKeystrokes([])).toBeNull();
  });

  it('returns null when any option is out of the single-digit range (1..9)', () => {
    expect(planSelectionKeystrokes([0])).toBeNull();
    expect(planSelectionKeystrokes([MAX_SELECTION_OPTION + 1])).toBeNull();
    expect(planSelectionKeystrokes([2, 99])).toBeNull();
  });

  it('returns null for non-integer option numbers', () => {
    expect(planSelectionKeystrokes([1.5])).toBeNull();
    expect(planSelectionKeystrokes([Number.NaN])).toBeNull();
  });

  it('accepts the full single-digit range boundary', () => {
    const plan = planSelectionKeystrokes([MAX_SELECTION_OPTION]);
    expect(plan?.[0]).toEqual({ literal: true, value: '9' });
  });
});
