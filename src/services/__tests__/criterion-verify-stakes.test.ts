// Runs via `bun test` — pure classifier, no DB access.
import { describe, it, expect } from 'bun:test';
import { CRITERION_SERVE_CAP, CRITERION_PANEL_SERVE_THRESHOLD } from '../harness-caps.ts';
import {
  classifyVerifyStakes,
  HIGH_STAKES_TRIGGERS,
  CONTESTED_CARD_KINDS,
  PANEL_CHECKER_COUNT,
  type VerifyStakesInput,
  type VerifyStakesResult,
} from '../criterion-verify-stakes.ts';

function input(overrides: Partial<VerifyStakesInput> = {}): VerifyStakesInput {
  return {
    reopenCount: overrides.reopenCount ?? 0,
    lastReopenSha: overrides.lastReopenSha ?? null,
    pendingRecheckReason: overrides.pendingRecheckReason ?? null,
    servedEpicCount: overrides.servedEpicCount ?? 0,
    openCardKinds: overrides.openCardKinds ?? [],
  };
}

describe('classifyVerifyStakes', () => {
  it('returns default single-checker result when no trigger matches', () => {
    const result = classifyVerifyStakes(input());
    expect(result).toEqual({
      panel: false,
      trigger: null,
      checkerCount: 1,
    });
  });

  describe('each HIGH_STAKES_TRIGGERS member', () => {
    for (const trigger of HIGH_STAKES_TRIGGERS) {
      it(`${trigger} trigger sets panel: true, trigger: '${trigger}', and checkerCount >= 2`, () => {
        let testInput: VerifyStakesInput;

        if (trigger === 'reopened-by-land') {
          // Test via pendingRecheckReason.
          testInput = input({ pendingRecheckReason: 'land-diff-intersects-evidence' });
        } else if (trigger === 'contested-card') {
          // Test with a decision card (one of CONTESTED_CARD_KINDS).
          testInput = input({ openCardKinds: ['decision'] });
        } else if (trigger === 'serve-burn') {
          // Test at CRITERION_PANEL_SERVE_THRESHOLD.
          testInput = input({ servedEpicCount: CRITERION_PANEL_SERVE_THRESHOLD });
        } else {
          throw new Error(`Unhandled trigger: ${trigger}`);
        }

        const result = classifyVerifyStakes(testInput);
        expect(result.panel).toBe(true);
        expect(result.trigger).toBe(trigger);
        expect(result.checkerCount).toBeGreaterThanOrEqual(2);
      });
    }
  });

  describe('serve-burn boundary', () => {
    it(`servedEpicCount: CRITERION_PANEL_SERVE_THRESHOLD - 1 => panel: false`, () => {
      const result = classifyVerifyStakes(input({ servedEpicCount: CRITERION_PANEL_SERVE_THRESHOLD - 1 }));
      expect(result.panel).toBe(false);
      expect(result.trigger).toBe(null);
      expect(result.checkerCount).toBe(1);
    });

    it(`servedEpicCount: CRITERION_PANEL_SERVE_THRESHOLD => panel: true, trigger: 'serve-burn'`, () => {
      const result = classifyVerifyStakes(input({ servedEpicCount: CRITERION_PANEL_SERVE_THRESHOLD }));
      expect(result.panel).toBe(true);
      expect(result.trigger).toBe('serve-burn');
      expect(result.checkerCount).toBeGreaterThanOrEqual(2);
    });

    it(`servedEpicCount: CRITERION_PANEL_SERVE_THRESHOLD + 1 => panel: true, trigger: 'serve-burn'`, () => {
      const result = classifyVerifyStakes(input({ servedEpicCount: CRITERION_PANEL_SERVE_THRESHOLD + 1 }));
      expect(result.panel).toBe(true);
      expect(result.trigger).toBe('serve-burn');
      expect(result.checkerCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('reopened-by-land alternative path', () => {
    it('reopenCount > 0 + lastReopenSha != null => trigger: reopened-by-land', () => {
      const result = classifyVerifyStakes(input({ reopenCount: 1, lastReopenSha: 'abc123' }));
      expect(result.panel).toBe(true);
      expect(result.trigger).toBe('reopened-by-land');
      expect(result.checkerCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('precedence: first match wins', () => {
    it('reopened-by-land + contested-card + serve-burn all set => trigger: reopened-by-land', () => {
      const result = classifyVerifyStakes(
        input({
          pendingRecheckReason: 'land-diff-intersects-evidence',
          openCardKinds: ['decision'],
          servedEpicCount: CRITERION_PANEL_SERVE_THRESHOLD,
        }),
      );
      expect(result.trigger).toBe('reopened-by-land');
    });

    it('contested-card + serve-burn (without reopened-by-land) => trigger: contested-card', () => {
      const result = classifyVerifyStakes(
        input({
          openCardKinds: ['blocker'],
          servedEpicCount: CRITERION_PANEL_SERVE_THRESHOLD,
        }),
      );
      expect(result.trigger).toBe('contested-card');
    });
  });

  describe('CONTESTED_CARD_KINDS matching', () => {
    it("matches 'decision' card", () => {
      const result = classifyVerifyStakes(input({ openCardKinds: ['decision'] }));
      expect(result.panel).toBe(true);
      expect(result.trigger).toBe('contested-card');
    });

    it("matches 'blocker' card", () => {
      const result = classifyVerifyStakes(input({ openCardKinds: ['blocker'] }));
      expect(result.panel).toBe(true);
      expect(result.trigger).toBe('contested-card');
    });

    it('ignores non-contested-card kinds', () => {
      const result = classifyVerifyStakes(input({ openCardKinds: ['question', 'approval'] }));
      expect(result.panel).toBe(false);
      expect(result.trigger).toBe(null);
    });
  });

  describe('defensive handling of invalid input', () => {
    it('treats non-finite reopenCount as 0', () => {
      const result = classifyVerifyStakes(
        input({ reopenCount: NaN, lastReopenSha: 'abc123' }),
      );
      // NaN reopenCount + lastReopenSha != null, but reopenCount is treated as 0,
      // so the reopened-by-land condition fails (reopenCount > 0 is false).
      expect(result.panel).toBe(false);
    });

    it('treats negative reopenCount as 0', () => {
      const result = classifyVerifyStakes(
        input({ reopenCount: -1, lastReopenSha: 'abc123' }),
      );
      expect(result.panel).toBe(false);
    });

    it('treats non-finite servedEpicCount as 0', () => {
      const result = classifyVerifyStakes(input({ servedEpicCount: Infinity }));
      // Infinity is non-finite, so it becomes 0.
      expect(result.panel).toBe(false);
    });

    it('treats negative servedEpicCount as 0', () => {
      const result = classifyVerifyStakes(input({ servedEpicCount: -5 }));
      expect(result.panel).toBe(false);
    });
  });

  describe('constant checks', () => {
    it('CRITERION_PANEL_SERVE_THRESHOLD < CRITERION_SERVE_CAP', () => {
      expect(CRITERION_PANEL_SERVE_THRESHOLD).toBeLessThan(CRITERION_SERVE_CAP);
    });

    it('PANEL_CHECKER_COUNT >= 2', () => {
      expect(PANEL_CHECKER_COUNT).toBeGreaterThanOrEqual(2);
    });

    it('HIGH_STAKES_TRIGGERS contains exactly the three expected triggers', () => {
      expect(HIGH_STAKES_TRIGGERS).toEqual(['reopened-by-land', 'contested-card', 'serve-burn']);
    });

    it('CONTESTED_CARD_KINDS includes decision and blocker', () => {
      expect(CONTESTED_CARD_KINDS).toContain('decision');
      expect(CONTESTED_CARD_KINDS).toContain('blocker');
    });
  });
});
