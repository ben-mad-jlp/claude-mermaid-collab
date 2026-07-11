/**
 * Unit tests for C2 command evidence gate (node-commands.ts).
 * Pure — no git, no spawn. Build real temp worktree-shaped dirs for realpathSync.
 * Run with `bun test src/services/__tests__/node-commands.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseNodeCommands,
  isCwdEscape,
  parseVerificationClaims,
  evaluateCommandEvidence,
  type RecordedCommand,
} from '../node-commands';

describe('node-commands', () => {
  let tempDir: string;
  let mainCheckout: string;
  let worktreeRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'node-commands-test-'));
    mainCheckout = join(tempDir, 'main');
    worktreeRoot = join(tempDir, 'worktree');
    mkdirSync(mainCheckout);
    mkdirSync(worktreeRoot);
    mkdirSync(join(worktreeRoot, 'ui'));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  describe('parseNodeCommands', () => {
    it('extracts Bash tool_use commands and their exit codes', () => {
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"call_1","name":"Bash","input":{"command":"cd ui && npx vitest run"}}]}}',
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"call_1","is_error":false,"content":[{"type":"text","text":"exit code: 0"}]}]}}',
      ].join('\n');

      const commands = parseNodeCommands(stdout, worktreeRoot);
      expect(commands).toHaveLength(1);
      expect(commands[0].cmd).toBe('cd ui && npx vitest run');
      expect(commands[0].exitCode).toBe(0);
      expect(commands[0].cwd).toBe(join(worktreeRoot, 'ui'));
    });

    it('parses exit code from "exit code:" message', () => {
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"call_1","name":"Bash","input":{"command":"npx tsc"}}]}}',
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"call_1","is_error":false,"content":[{"type":"text","text":"Exit code 2"}]}]}}',
      ].join('\n');

      const commands = parseNodeCommands(stdout, worktreeRoot);
      expect(commands[0].exitCode).toBe(2);
    });

    it('sets exitCode=1 on is_error=true', () => {
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"call_1","name":"Bash","input":{"command":"failing_cmd"}}]}}',
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"call_1","is_error":true,"content":[{"type":"text","text":"command not found"}]}]}}',
      ].join('\n');

      const commands = parseNodeCommands(stdout, worktreeRoot);
      expect(commands[0].exitCode).toBe(1);
    });

    it('defaults to exitCode=0 on clean result with no exit code message', () => {
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"call_1","name":"Bash","input":{"command":"echo ok"}}]}}',
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"call_1","is_error":false,"content":[{"type":"text","text":"ok"}]}]}}',
      ].join('\n');

      const commands = parseNodeCommands(stdout, worktreeRoot);
      expect(commands[0].exitCode).toBe(0);
    });

    it('ignores non-Bash tool_use and unparseable lines', () => {
      const stdout = [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"call_1","name":"Read","input":{"file":"x"}}]}}',
        'unparseable line',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"call_2","name":"Bash","input":{"command":"pwd"}}]}}',
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"call_2","is_error":false}]}}',
      ].join('\n');

      const commands = parseNodeCommands(stdout, worktreeRoot);
      expect(commands).toHaveLength(1);
      expect(commands[0].cmd).toBe('pwd');
    });

    it('caps at 200 commands (defensive)', () => {
      const lines: string[] = [];
      for (let i = 0; i < 250; i++) {
        lines.push(`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"call_${i}","name":"Bash","input":{"command":"echo ${i}"}}]}}`);
        lines.push(`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"call_${i}","is_error":false}]}}`);
      }
      const stdout = lines.join('\n');

      const commands = parseNodeCommands(stdout, worktreeRoot);
      expect(commands.length).toBeLessThanOrEqual(200);
    });
  });

  describe('isCwdEscape', () => {
    it('rejects cwd outside the worktree', () => {
      const escape = isCwdEscape(mainCheckout, worktreeRoot);
      expect(escape).toBe(true);
    });

    it('accepts cwd inside the worktree', () => {
      const cwdPath = join(worktreeRoot, 'subdir');
      mkdirSync(cwdPath);
      const safe = isCwdEscape(cwdPath, worktreeRoot);
      expect(safe).toBe(false);
    });

    it('accepts <worktree>/ui even with a symlink (A2 case)', () => {
      const uiPath = join(worktreeRoot, 'ui');
      const mainNodeModules = join(mainCheckout, 'node_modules');
      mkdirSync(mainNodeModules);
      const symlinkTarget = join(uiPath, 'node_modules');
      try {
        symlinkSync(mainNodeModules, symlinkTarget);
      } catch {
        // symlink creation may fail on some systems; skip this check
        return;
      }
      const safe = isCwdEscape(uiPath, worktreeRoot);
      expect(safe).toBe(false);
    });

    it('rejects absolute path with .. traversal', () => {
      const escaped = isCwdEscape(join(worktreeRoot, '..', 'other'), worktreeRoot);
      expect(escaped).toBe(true);
    });
  });

  describe('parseVerificationClaims', () => {
    it('parses claims from a VERIFICATION: block', () => {
      const text = [
        '## Review',
        'Some finding.',
        '',
        'VERIFICATION:',
        '- ran: bun run scripts/test-backend.ts',
        '- ran: npx tsc --noEmit',
        '',
        'VERDICT: PASS',
      ].join('\n');

      const claims = parseVerificationClaims([], text);
      expect(claims).toEqual(['bun run scripts/test-backend.ts', 'npx tsc --noEmit']);
    });

    it('stops parsing at the next heading', () => {
      const text = [
        'VERIFICATION:',
        '- ran: test1',
        '## Another',
        '- ran: test2',
      ].join('\n');

      const claims = parseVerificationClaims([], text);
      expect(claims).toEqual(['test1']);
    });

    it('returns empty array if no VERIFICATION block exists', () => {
      const text = 'Just a regular report.\n\nVERDICT: PASS';
      const claims = parseVerificationClaims([], text);
      expect(claims).toEqual([]);
    });

    it('trims whitespace from claims', () => {
      const text = [
        'VERIFICATION:',
        '  -  ran:  bun run test.ts  ',
      ].join('\n');

      const claims = parseVerificationClaims([], text);
      expect(claims[0]).toBe('bun run test.ts');
    });
  });

  describe('evaluateCommandEvidence', () => {
    it('rejects cwd escape', () => {
      const commands: RecordedCommand[] = [
        { cmd: 'npx vitest run', cwd: mainCheckout, exitCode: 0 },
      ];
      const result = evaluateCommandEvidence({
        commands,
        claims: [],
        worktreeRoot,
      });
      expect(result.reject).toBe(true);
      expect(result.escapes).toHaveLength(1);
      expect(result.reasons[0]).toContain('npx vitest run');
      expect(result.reasons[0]).toContain(mainCheckout);
    });

    it('does NOT reject a READ-ONLY diagnostic that escaped (C3 cwd-escape class — correct code)', () => {
      // A node exploring the wider repo (grep/find) that cd'd out backs no criterion and cannot
      // fake a green — rejecting the whole leaf over it discards correct code.
      const commands: RecordedCommand[] = [
        { cmd: 'cd /repo && grep -rn "mission-status" .collab', cwd: mainCheckout, exitCode: 0 },
        { cmd: 'find . -name "MissionBlock.test.tsx"', cwd: mainCheckout, exitCode: 0 },
      ];
      const result = evaluateCommandEvidence({ commands, claims: [], worktreeRoot });
      expect(result.reject).toBe(false);
      expect(result.escapes).toHaveLength(0);
      expect(result.reasons.some((r) => r.includes('non-fatal'))).toBe(true);
    });

    it('STILL rejects a VERIFICATION command that escaped — false-green guard intact', () => {
      const commands: RecordedCommand[] = [
        { cmd: 'grep -rn foo .', cwd: mainCheckout, exitCode: 0 }, // read-only → non-fatal
        { cmd: 'cd /repo/ui && npm run test:ci', cwd: mainCheckout, exitCode: 0 }, // verification → fatal
      ];
      const result = evaluateCommandEvidence({ commands, claims: [], worktreeRoot });
      expect(result.reject).toBe(true);
      expect(result.escapes).toHaveLength(1);
      expect(result.escapes[0]!.cmd).toContain('npm run test:ci');
    });

    it('does NOT reject an escaped verification when in-worktree verification ALSO ran (master-baseline comparison)', () => {
      // The subset-of-baseline verdict REQUIRES running the suite in the master checkout to collect
      // the baseline failing-name set. When the leaf ALSO verified in the worktree, that master run
      // is a baseline, not a false-green — the in-worktree run is the authoritative evidence.
      const commands: RecordedCommand[] = [
        { cmd: 'bun test ./src/services', cwd: worktreeRoot, exitCode: 0 }, // in-worktree verification (authoritative)
        { cmd: 'cd /repo && bun test ./src/services', cwd: mainCheckout, exitCode: 0 }, // master baseline (escaped, non-fatal)
      ];
      const result = evaluateCommandEvidence({ commands, claims: [], worktreeRoot });
      expect(result.reject).toBe(false);
      expect(result.escapes).toHaveLength(0);
      expect(result.reasons.some((r) => r.includes('baseline'))).toBe(true);
    });

    it('warns on unbacked claim (policy="warn")', () => {
      const commands: RecordedCommand[] = [];
      const result = evaluateCommandEvidence({
        commands,
        claims: ['bun run scripts/test-backend.ts'],
        worktreeRoot,
      });
      expect(result.reject).toBe(false);
      expect(result.unbackedClaims).toHaveLength(1);
      expect(result.reasons[0]).toContain('unbacked');
      expect(result.reasons[0]).toContain('bun run scripts/test-backend.ts');
    });

    it('matches claim against recorded command', () => {
      const commands: RecordedCommand[] = [
        { cmd: 'bun run scripts/test-backend.ts', cwd: worktreeRoot, exitCode: 0 },
      ];
      const result = evaluateCommandEvidence({
        commands,
        claims: ['bun run scripts/test-backend.ts'],
        worktreeRoot,
      });
      expect(result.unbackedClaims).toHaveLength(0);
      expect(result.reject).toBe(false);
    });

    it('matches claim with normalised whitespace', () => {
      const commands: RecordedCommand[] = [
        { cmd: 'bun  run   scripts/test-backend.ts', cwd: worktreeRoot, exitCode: 0 },
      ];
      const result = evaluateCommandEvidence({
        commands,
        claims: ['bun run scripts/test-backend.ts'],
        worktreeRoot,
      });
      expect(result.unbackedClaims).toHaveLength(0);
    });

    it('accepts zero commands and zero claims unchanged', () => {
      const result = evaluateCommandEvidence({
        commands: [],
        claims: [],
        worktreeRoot,
      });
      expect(result.reject).toBe(false);
      expect(result.reasons).toHaveLength(0);
      expect(result.escapes).toHaveLength(0);
      expect(result.unbackedClaims).toHaveLength(0);
    });

    it('combines escapes and unbacked claims in reasons', () => {
      const commands: RecordedCommand[] = [
        { cmd: 'npx vitest run', cwd: mainCheckout, exitCode: 0 }, // verification escape → fatal
      ];
      const result = evaluateCommandEvidence({
        commands,
        claims: ['unbacked_claim'],
        worktreeRoot,
      });
      expect(result.reject).toBe(true);
      expect(result.reasons.length).toBe(2);
      expect(result.reasons[0]).toContain('npx vitest run');
      expect(result.reasons[1]).toContain('unbacked_claim');
    });
  });
});
