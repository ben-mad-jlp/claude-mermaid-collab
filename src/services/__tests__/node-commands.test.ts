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
  parseResultAssertion,
  evaluateCommandEvidence,
  type RecordedCommand,
  type ResultAssertion,
} from '../node-commands';
import { validateReviewGrounding } from '../review-citations';
import { uncitedCriteriaAreAllCommandResults } from '../criteria-citability';

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
      expect(result.contradictedClaims).toHaveLength(0);
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
      expect(result.contradictedClaims).toHaveLength(0);
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

  describe('result-assertion evidence', () => {
    it('parseResultAssertion extracts grep command with "returns 0" phrasing', () => {
      const text = 'grep -c OrchestratorLadder ProjectSettingsModal.tsx returns 0';
      const ra = parseResultAssertion(text);
      expect(ra).not.toBeNull();
      expect(ra!.command).toBe('grep -c OrchestratorLadder ProjectSettingsModal.tsx');
      expect(ra!.assertsAbsence).toBe(true);
    });

    it('parseResultAssertion extracts backticked command', () => {
      const text = 'Verify that `grep -rn "missing-symbol" src` returns 0';
      const ra = parseResultAssertion(text);
      expect(ra).not.toBeNull();
      expect(ra!.command).toContain('grep -rn');
      expect(ra!.assertsAbsence).toBe(true);
    });

    it('parseResultAssertion recognizes "→ 0" phrasing', () => {
      const text = 'grep -c missing-export index.ts → 0';
      const ra = parseResultAssertion(text);
      expect(ra).not.toBeNull();
      expect(ra!.assertsAbsence).toBe(true);
    });

    it('parseResultAssertion recognizes "0 matches" phrasing', () => {
      const text = 'rg "OldAPI" lib/ produces 0 matches';
      const ra = parseResultAssertion(text);
      expect(ra).not.toBeNull();
      expect(ra!.assertsAbsence).toBe(true);
    });

    it('parseResultAssertion recognizes "no matches" phrasing', () => {
      const text = 'grep -c deprecated src/ no matches';
      const ra = parseResultAssertion(text);
      expect(ra).not.toBeNull();
      expect(ra!.assertsAbsence).toBe(true);
    });

    it('parseResultAssertion returns null for non-result-assertion text', () => {
      const text = 'leaf compiles cleanly';
      const ra = parseResultAssertion(text);
      expect(ra).toBeNull();
    });

    it('parseResultAssertion returns null for text without absence phrasing', () => {
      const text = 'grep -c something file.ts';
      const ra = parseResultAssertion(text);
      expect(ra).toBeNull();
    });

    it('BACKS absence claim when recorded grep exited non-zero', () => {
      const commands: RecordedCommand[] = [
        { cmd: 'grep -c OrchestratorLadder ProjectSettingsModal.tsx', cwd: worktreeRoot, exitCode: 1 },
      ];
      const claim = 'grep -c OrchestratorLadder ProjectSettingsModal.tsx returns 0';
      const result = evaluateCommandEvidence({
        commands,
        claims: [claim],
        worktreeRoot,
      });
      expect(result.reject).toBe(false);
      expect(result.contradictedClaims).toHaveLength(0);
      expect(result.unbackedClaims).toHaveLength(0);
    });

    it('REJECTS false absence when recorded grep exited 0 (matches found)', () => {
      const commands: RecordedCommand[] = [
        { cmd: 'grep -c OrchestratorLadder ProjectSettingsModal.tsx', cwd: worktreeRoot, exitCode: 0 },
      ];
      const claim = 'grep -c OrchestratorLadder ProjectSettingsModal.tsx returns 0';
      const result = evaluateCommandEvidence({
        commands,
        claims: [claim],
        worktreeRoot,
      });
      expect(result.reject).toBe(true);
      expect(result.contradictedClaims).toHaveLength(1);
      expect(result.contradictedClaims[0]).toBe(claim);
      expect(result.reasons.some((r) => r.includes('contradicted'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('exits 0'))).toBe(true);
    });

    it('parseVerificationClaims harvests result-assertion from criteria', () => {
      const criteria = [
        {
          text: 'grep -c OrchestratorLadder ProjectSettingsModal.tsx returns 0',
        },
      ];
      const reviewText = ['VERIFICATION:', '- ran: bun run test'].join('\n');
      const claims = parseVerificationClaims(criteria, reviewText);
      expect(claims).toHaveLength(2);
      expect(claims[0]).toBe('bun run test');
      expect(claims[1]).toContain('grep -c OrchestratorLadder');
    });

    it('does not duplicate plain claims when criteria parsing', () => {
      const criteria = [
        {
          text: 'some other criterion without absence assertion',
        },
      ];
      const claims = parseVerificationClaims(criteria, '');
      expect(claims).toHaveLength(0);
    });

    it('combines result-assertion contradiction with other rejections', () => {
      const commands: RecordedCommand[] = [
        { cmd: 'grep -c bug src/', cwd: worktreeRoot, exitCode: 0 }, // contradicts absence
        { cmd: 'npx vitest run', cwd: mainCheckout, exitCode: 0 }, // escape
      ];
      const result = evaluateCommandEvidence({
        commands,
        claims: ['grep -c bug src/ returns 0'],
        worktreeRoot,
      });
      expect(result.reject).toBe(true);
      expect(result.contradictedClaims).toHaveLength(1);
      expect(result.escapes).toHaveLength(1);
    });
  });

  describe('end-to-end: review-grounding accepts a zero-match-evidenced DELETION criterion', () => {
    // The exact wall shape: a removal leaf's ONLY proof for "ptyManager import removed" is a
    // command result, which has no file:line to cite. The reviewer marks it [N/A] (per the
    // review-node prompt's ABSENCE/NON-GOAL instruction) — so G3 grounding never treats it as an
    // offender — AND separately the command-evidence gate verifies the underlying claim against
    // the command actually recorded at the spawn boundary, never trusting the reviewer's prose.
    it('N/A-marked absence + a recorded, matching zero-match command ⇒ grounding ok AND evidence accepts', () => {
      const changeSet = ['src/server.ts'];
      const reviewText = [
        '## CRITERIA',
        "- [N/A] the sole import of ptyManager is removed — verified via grep -rn 'ptyManager' src/ returns no matches",
        '- [MET] server.ts drops the pty-manager wiring — src/server.ts:12',
        '',
        'VERIFICATION:',
        "- ran: grep -rn 'ptyManager' src/",
        '',
        'VERDICT: PASS',
      ].join('\n');

      const grounding = validateReviewGrounding(reviewText, changeSet);
      expect(grounding.status).toBe('ok'); // N/A criteria are never offenders, never "cites nothing"

      // The command-evidence gate independently verifies the reviewer's VERIFICATION: claim
      // against what actually ran (recorded at the spawn boundary) — it does not trust the marker.
      const recordedCommands: RecordedCommand[] = [
        { cmd: "grep -rn 'ptyManager' src/", cwd: worktreeRoot, exitCode: 1 }, // no matches → exit 1
      ];
      const claims = parseVerificationClaims(grounding.criteria, reviewText);
      expect(claims.some((c) => c.includes('ptyManager'))).toBe(true);
      const evidence = evaluateCommandEvidence({ commands: recordedCommands, claims, worktreeRoot });
      expect(evidence.reject).toBe(false);
      expect(evidence.contradictedClaims).toHaveLength(0);
    });

    it('a FABRICATED zero-match claim (command never ran) is REJECTED by command-evidence, fail-closed', () => {
      const changeSet = ['src/server.ts'];
      const reviewText = [
        '## CRITERIA',
        "- [N/A] the sole import of ptyManager is removed — verified via grep -rn 'ptyManager' src/ returns no matches",
        '- [MET] server.ts drops the pty-manager wiring — src/server.ts:12',
        '',
        'VERIFICATION:',
        "- ran: grep -rn 'ptyManager' src/",
        '',
        'VERDICT: PASS',
      ].join('\n');
      const grounding = validateReviewGrounding(reviewText, changeSet);
      const claims = parseVerificationClaims(grounding.criteria, reviewText);
      // No matching command was actually recorded this cycle.
      const evidence = evaluateCommandEvidence({ commands: [], claims, worktreeRoot });
      expect(evidence.unbackedClaims.length).toBeGreaterThan(0);
    });

    it('the same absence criterion, uncited, still defers cleanly via uncitedCriteriaAreAllCommandResults', () => {
      // Regression path for a reviewer that (incorrectly) marks the criterion MET/UNMET
      // instead of N/A but still cites nothing — the floor-path defer must still hold.
      const criteria = [
        { text: "the sole import of ptyManager is removed — grep -rn 'ptyManager' src/ returns no matches", outcome: 'unmet', citations: [] as unknown[] },
      ];
      expect(uncitedCriteriaAreAllCommandResults(criteria, [])).toBe(true);
    });
  });
});
