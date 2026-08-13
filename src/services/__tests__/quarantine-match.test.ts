import { describe, it, expect } from 'bun:test';
import { quarantineCoversFailure } from '../quarantine-match';

describe('quarantineCoversFailure', () => {
  describe('arm 1 (verbatim)', () => {
    it('covers a failing entry that matches a quarantine entry after normalization', () => {
      const failing = 'src/services/__tests__/x.test.ts';
      const quarantine = ['(500/600) src/services/__tests__/x.test.ts'];
      const result = quarantineCoversFailure(failing, quarantine, '', {});
      expect(result).toBe(true);
    });

    it('does not cover a failing entry that does not match any quarantine entry', () => {
      const failing = 'src/services/__tests__/y.test.ts';
      const quarantine = ['src/services/__tests__/x.test.ts'];
      const result = quarantineCoversFailure(failing, quarantine, '', {});
      expect(result).toBe(false);
    });
  });

  describe('arm 2 (section)', () => {
    it('covers all failing test names in a section when all are quarantined', () => {
      const failing = 'src/services/__tests__/x.test.ts';
      const quarantine = ['test name 1', 'test name 2'];
      const gateOutput = `
──── ${failing} ────
  × test name 1
  × test name 2
──── next file ────
  × other test
      `;
      const result = quarantineCoversFailure(failing, quarantine, gateOutput, {});
      expect(result).toBe(true);
    });

    it('section arm still requires every parsed case name to be quarantined', () => {
      const failing = 'src/services/__tests__/x.test.ts';
      const quarantine = ['test name 1'];
      const gateOutput = `
──── ${failing} ────
  × test name 1
  × test name 2
      `;
      const result = quarantineCoversFailure(failing, quarantine, gateOutput, {});
      expect(result).toBe(false);
    });

    it('does not cover when section has no parsed test names', () => {
      const failing = 'src/services/__tests__/x.test.ts';
      const quarantine = ['something'];
      const gateOutput = `
──── ${failing} ────
Some unparseable output
      `;
      const result = quarantineCoversFailure(failing, quarantine, gateOutput, {});
      expect(result).toBe(false);
    });
  });

  describe('arm 3 (title→file)', () => {
    it('case-title quarantine row covers a file-path failing entry via resolveTestFile', () => {
      const failing = 'src/services/__tests__/server-supervisor-term-grace.test.ts';
      const quarantine = [
        'watchdog kill escalates SIGTERM → SIGKILL > a sidecar that ignores SIGTERM is still SIGKILLed after the grace window',
      ];
      const resolveTestFile = (project: string, test: string): string | null => {
        if (
          test ===
          'watchdog kill escalates SIGTERM → SIGKILL > a sidecar that ignores SIGTERM is still SIGKILLed after the grace window'
        ) {
          return 'src/services/__tests__/server-supervisor-term-grace.test.ts';
        }
        return null;
      };

      const result = quarantineCoversFailure(failing, quarantine, '', {
        project: '/repo',
        resolveTestFile,
      });

      expect(result).toBe(true);
    });

    it('verifies the injected resolver was actually consulted', () => {
      const failing = 'src/services/__tests__/server-supervisor-term-grace.test.ts';
      const quarantine = [
        'watchdog kill escalates SIGTERM → SIGKILL > a sidecar that ignores SIGTERM is still SIGKILLed after the grace window',
      ];
      let resolveCallCount = 0;
      let resolveCallArgs: string[] = [];

      const resolveTestFile = (project: string, test: string): string | null => {
        resolveCallCount++;
        resolveCallArgs.push(test);
        if (
          test ===
          'watchdog kill escalates SIGTERM → SIGKILL > a sidecar that ignores SIGTERM is still SIGKILLed after the grace window'
        ) {
          return 'src/services/__tests__/server-supervisor-term-grace.test.ts';
        }
        return null;
      };

      quarantineCoversFailure(failing, quarantine, '', {
        project: '/repo',
        resolveTestFile,
      });

      expect(resolveCallCount).toBe(1);
      expect(resolveCallArgs[0]).toBe(
        'watchdog kill escalates SIGTERM → SIGKILL > a sidecar that ignores SIGTERM is still SIGKILLed after the grace window',
      );
    });

    it('handles resolveTestFile returning null without throwing', () => {
      const failing = 'src/services/__tests__/x.test.ts';
      const quarantine = ['some unrelated title'];
      const resolveTestFile = (): string | null => null;

      const result = quarantineCoversFailure(failing, quarantine, '', {
        project: '/repo',
        resolveTestFile,
      });

      expect(result).toBe(false);
    });

    it('handles resolveTestFile throwing without throwing', () => {
      const failing = 'src/services/__tests__/x.test.ts';
      const quarantine = ['some title that will throw'];
      const resolveTestFile = (): string | null => {
        throw new Error('Unexpected error');
      };

      const result = quarantineCoversFailure(failing, quarantine, '', {
        project: '/repo',
        resolveTestFile,
      });

      expect(result).toBe(false);
    });

    it('skips arm 3 when project is not provided', () => {
      const failing = 'src/services/__tests__/x.test.ts';
      const quarantine = [
        'watchdog kill escalates SIGTERM → SIGKILL > a sidecar that ignores SIGTERM is still SIGKILLed after the grace window',
      ];
      let resolveCallCount = 0;

      const resolveTestFile = (): string | null => {
        resolveCallCount++;
        return null;
      };

      // Without project, arm 3 is skipped
      const result = quarantineCoversFailure(failing, quarantine, '', {
        resolveTestFile,
      });

      expect(result).toBe(false);
      expect(resolveCallCount).toBe(0);
    });

    it('normalizes paths by stripping leading ./', () => {
      const failing = 'src/services/__tests__/x.test.ts';
      const quarantine = ['test title'];
      const resolveTestFile = (): string | null => {
        return './src/services/__tests__/x.test.ts';
      };

      const result = quarantineCoversFailure(failing, quarantine, '', {
        project: '/repo',
        resolveTestFile,
      });

      expect(result).toBe(true);
    });

    it('only applies when failing looks like a file path', () => {
      const failing = 'test case name without a dot ts extension';
      const quarantine = ['some title'];
      let resolveCallCount = 0;

      const resolveTestFile = (): string | null => {
        resolveCallCount++;
        return null;
      };

      const result = quarantineCoversFailure(failing, quarantine, '', {
        project: '/repo',
        resolveTestFile,
      });

      // Arm 3 should not be invoked because failing doesn't match SPEC_FILE_RE
      expect(resolveCallCount).toBe(0);
      expect(result).toBe(false);
    });
  });

  describe('arm precedence', () => {
    it('returns true on first matching arm', () => {
      const failing = '(1/1) src/services/__tests__/x.test.ts';
      const quarantine = ['src/services/__tests__/x.test.ts'];
      const gateOutput = ''; // No section

      // Arm 1 should match
      const result = quarantineCoversFailure(failing, quarantine, gateOutput, {
        project: '/repo',
      });

      expect(result).toBe(true);
    });
  });
});
