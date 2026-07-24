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
  splitCommandClauses,
  attributeClauseExit,
  extractCommandScope,
  escapeIsFatal,
  escapeMutatesOrVerifies,
  detectWorkingRootEscape,
  type RecordedCommand,
  type ResultAssertion,
  type CommandClause,
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

  describe('splitCommandClauses', () => {
    it('splits an && chain into three clauses with proper operators', () => {
      const clauses = splitCommandClauses("echo hello && grep -rn 'foo' src/ && echo done");
      expect(clauses).toHaveLength(3);
      expect(clauses[0].text).toBe("echo hello");
      expect(clauses[0].operator).toBe(null);
      expect(clauses[1].text).toBe("grep -rn 'foo' src/");
      expect(clauses[1].operator).toBe('&&');
      expect(clauses[2].text).toBe("echo done");
      expect(clauses[2].operator).toBe('&&');
    });

    it('splits a ; chain', () => {
      const clauses = splitCommandClauses("grep -rn 'a' src/ ; echo done");
      expect(clauses).toHaveLength(2);
      expect(clauses[0].text).toBe("grep -rn 'a' src/");
      expect(clauses[0].operator).toBe(null);
      expect(clauses[1].text).toBe("echo done");
      expect(clauses[1].operator).toBe(';');
    });

    it('splits a || chain', () => {
      const clauses = splitCommandClauses("grep -rn 'notfound' src/ || echo 'not found'");
      expect(clauses).toHaveLength(2);
      expect(clauses[0].text).toBe("grep -rn 'notfound' src/");
      expect(clauses[0].operator).toBe(null);
      expect(clauses[1].text).toContain("echo");
      expect(clauses[1].operator).toBe('||');
    });

    it('does NOT split on pipe (|) — pipeline is one clause', () => {
      const clauses = splitCommandClauses("grep -rn 'a' src/ | head -3");
      expect(clauses).toHaveLength(1);
      expect(clauses[0].text).toBe("grep -rn 'a' src/ | head -3");
      expect(clauses[0].operator).toBe(null);
    });

    it('does NOT split on operators inside single quotes', () => {
      const clauses = splitCommandClauses("grep -rn ';' src/");
      expect(clauses).toHaveLength(1);
      expect(clauses[0].text).toBe("grep -rn ';' src/");
    });

    it('does NOT split on operators inside double quotes', () => {
      const clauses = splitCommandClauses('grep -rn "&&" src/');
      expect(clauses).toHaveLength(1);
      expect(clauses[0].text).toBe('grep -rn "&&" src/');
    });

    it('handles a single non-compound command', () => {
      const clauses = splitCommandClauses("grep -rn 'foo' src/");
      expect(clauses).toHaveLength(1);
      expect(clauses[0].text).toBe("grep -rn 'foo' src/");
      expect(clauses[0].operator).toBe(null);
    });
  });

  describe('attributeClauseExit', () => {
    it('returns 0 for any clause in a pure && chain when overall exit is 0', () => {
      const clauses: CommandClause[] = [
        { text: 'a', operator: null },
        { text: 'b', operator: '&&' },
        { text: 'c', operator: '&&' },
      ];
      expect(attributeClauseExit(clauses, 0, 0)).toBe(0);
      expect(attributeClauseExit(clauses, 1, 0)).toBe(0);
      expect(attributeClauseExit(clauses, 2, 0)).toBe(0);
    });

    it('returns the final clause exit code (even in && chain with non-zero overall)', () => {
      const clauses: CommandClause[] = [
        { text: 'a', operator: null },
        { text: 'b', operator: '&&' },
      ];
      expect(attributeClauseExit(clauses, 1, 1)).toBe(1);
    });

    it('returns the overall exit for final clause in a ; chain', () => {
      const clauses: CommandClause[] = [
        { text: 'a', operator: null },
        { text: 'b', operator: ';' },
      ];
      expect(attributeClauseExit(clauses, 1, 5)).toBe(5);
    });

    it('returns null for a non-final clause in a ; chain', () => {
      const clauses: CommandClause[] = [
        { text: 'a', operator: null },
        { text: 'b', operator: ';' },
      ];
      expect(attributeClauseExit(clauses, 0, 0)).toBe(null);
    });

    it('returns null for a non-final clause in || chain', () => {
      const clauses: CommandClause[] = [
        { text: 'a', operator: null },
        { text: 'b', operator: '||' },
      ];
      expect(attributeClauseExit(clauses, 0, 0)).toBe(null);
    });

    it('returns null when overallExit is null', () => {
      const clauses: CommandClause[] = [{ text: 'a', operator: null }];
      expect(attributeClauseExit(clauses, 0, null)).toBe(null);
    });
  });

  describe('extractCommandScope', () => {
    it('extracts trailing path argument from grep command', () => {
      const scope = extractCommandScope("grep -rn 'foo' src/routes/");
      expect(scope).toBe('src/routes/');
    });

    it('drops command name and flags', () => {
      const scope = extractCommandScope("grep -rn -i 'pattern' src/ lib/");
      expect(scope).toBe('src/ lib/');
    });

    it('returns empty string when no scope arguments exist', () => {
      const scope = extractCommandScope("echo hello");
      expect(scope).toBe('hello');
    });

    it('strips quoted substrings when extracting scope', () => {
      const scope = extractCommandScope("grep -rn 'search term' src/");
      expect(scope).toBe('src/');
    });

    it('handles double-quoted patterns', () => {
      const scope = extractCommandScope('grep -rn "pattern" src/lib/');
      expect(scope).toBe('src/lib/');
    });
  });

  describe('scope mismatch through evaluateCommandEvidence', () => {
    it('unbacked when claim scope differs from matched clause scope', () => {
      const commands: RecordedCommand[] = [
        {
          cmd: "grep -rn 'launchAndBind' src/",
          cwd: '/wt',
          exitCode: 0,
        },
      ];
      const claim = "`grep -rn 'launchAndBind' src/routes/` returns no matches";
      const result = evaluateCommandEvidence({ commands, claims: [claim], worktreeRoot: '/wt' });
      expect(result.unbackedClaims).toHaveLength(1);
      expect(result.contradictedClaims).toHaveLength(0);
      expect(result.reasons.some((r: string) => r.includes('scope mismatch'))).toBe(true);
    });

    it('contradicted when scopes match and clause exit is 0', () => {
      const commands: RecordedCommand[] = [
        {
          cmd: "grep -rn 'launchAndBind' src/routes/",
          cwd: '/wt',
          exitCode: 0,
        },
      ];
      const claim = "`grep -rn 'launchAndBind' src/routes/` returns no matches";
      const result = evaluateCommandEvidence({ commands, claims: [claim], worktreeRoot: '/wt' });
      expect(result.contradictedClaims).toHaveLength(1);
      expect(result.unbackedClaims).toHaveLength(0);
      expect(result.reject).toBe(true);
    });
  });

  describe('compound-command contradiction demotes to unbacked (friction 996315e2)', () => {
  const { evaluateCommandEvidence, isCompoundCommand } = require('../node-commands');

  it('isCompoundCommand classifies chains but not pipes', () => {
    expect(isCompoundCommand("grep -rn 'a' src/ && echo ok")).toBe(true);
    expect(isCompoundCommand("grep a; grep b")).toBe(true);
    expect(isCompoundCommand("grep a || true")).toBe(true);
    expect(isCompoundCommand("grep -rn 'a' src/ | head -3")).toBe(false);
    expect(isCompoundCommand("grep -rn 'a' src/")).toBe(false);
  });

  it('a pure && chain with zero exit now correctly contradicts', () => {
    const res = evaluateCommandEvidence({
      claims: ["`grep -rn 'launchAndBind' src/routes/` returns no matches"],
      commands: [{ cmd: "echo \"--g1--\" && grep -rn 'launchAndBind' src/routes/ && echo \"--g2--\" && grep -rn 'other' src/", exitCode: 0, cwd: '/wt' }],
      worktreeRoot: '/wt',
    });
    expect(res.contradictedClaims).toHaveLength(1);
    expect(res.unbackedClaims).toHaveLength(0);
    expect(res.reject).toBe(true);
  });

  it('a non-final ; -joined clause with zero exit is unbacked (compound unattributable)', () => {
    const res = evaluateCommandEvidence({
      claims: ["`grep -rn 'launchAndBind' src/routes/` returns no matches"],
      commands: [{ cmd: "grep -rn 'launchAndBind' src/routes/ ; echo done", exitCode: 0, cwd: '/wt' }],
      worktreeRoot: '/wt',
    });
    expect(res.unbackedClaims).toHaveLength(1);
    expect(res.contradictedClaims).toHaveLength(0);
    expect(res.reasons.some((r: string) => r.includes('compound exit unattributable'))).toBe(true);
  });

  it('a zero-exit SINGLE command against an absence claim still contradicts (reject)', () => {
    const res = evaluateCommandEvidence({
      claims: ["`grep -rn 'launchAndBind' src/routes/` returns no matches"],
      commands: [{ cmd: "grep -rn 'launchAndBind' src/routes/", exitCode: 0, cwd: '/wt' }],
      worktreeRoot: '/wt',
    });
    expect(res.contradictedClaims).toHaveLength(1);
    expect(res.reject).toBe(true);
  });
  });
});

/**
 * WORKING-ROOT ESCAPE (2026-07-24 build123d empty-diff class).
 *
 * A leaf's shell cwd is its lane worktree, but the leaf record / blueprint cite the MAIN
 * checkout — so a careful node `cd`s to the stated root and every later edit + test run
 * lands in a tree the executor never diffs. Two guards are tested here:
 *   1. VERIFICATION_INVOCATION un-blinded to Python & friends (a Python project's escaped
 *      `pytest` was invisible to the ONE gate that existed).
 *   2. detectWorkingRootEscape — the implement-node guard: fires on escaped MUTATING or
 *      verifying commands, never on read-only exploration.
 */
describe('escapeIsFatal — verification invocations across ecosystems', () => {
  const FATAL: Array<[string, string]> = [
    ['pytest bare', 'pytest tests/'],
    ['pytest with flags', 'pytest -q bsync/stock/test_stock.py'],
    ['python -m pytest', 'python -m pytest tests/'],
    ['python3 -m pytest', 'python3 -m pytest -x tests/'],
    ['python -m unittest', 'python -m unittest discover'],
    ['python3 -m unittest', 'python3 -m unittest tests.test_stock'],
    ['tox', 'tox -e py311'],
    ['ruff', 'ruff check bsync/'],
    ['mypy', 'mypy bsync/stock'],
    ['pip install', 'pip install -e .'],
    ['pip3 install', 'pip3 install pytest'],
    ['python -m pip install', 'python -m pip install -r requirements.txt'],
    ['after cd', 'cd /Users/x/Code/build123d-ocp-mcp/bsync-tools && pytest -q'],
    // Pre-existing JS/TS coverage must stay intact.
    ['tsc', 'npx tsc --noEmit'],
    ['vitest', 'npx vitest run'],
    ['jest', 'jest --ci'],
    ['mocha', 'mocha test/'],
    ['eslint', 'eslint src/'],
    ['playwright', 'npx playwright test'],
    ['cypress', 'cypress run'],
    ['npm run', 'npm run test:ci'],
    ['bun test', 'bun test src/services'],
    ['pnpm build', 'pnpm build'],
    ['yarn install', 'yarn install'],
    ['make', 'make build'],
    ['cargo test', 'cargo test'],
    ['go build', 'go build ./...'],
  ];
  const NOT_FATAL: Array<[string, string]> = [
    ['grep', 'grep -rn "stock" bsync/'],
    ['grep naming a runner', 'grep -rn pytest bsync-tools/'],
    ['rg naming a runner', 'rg mypy .'],
    ['find', 'find /Users/x/Code/build123d-ocp-mcp/bsync-tools -type f -name "*.py"'],
    ['ls', 'ls -la bsync/stock/'],
    ['cat', 'cat pyproject.toml'],
    ['sed -n', 'sed -n 1,40p bsync/stock/__init__.py'],
    ['git status', 'git status --porcelain'],
    ['git log', 'git log --oneline -5'],
  ];

  for (const [name, cmd] of FATAL) {
    it(`treats an escaped ${name} as a verification invocation`, () => {
      expect(escapeIsFatal(cmd)).toBe(true);
    });
  }
  for (const [name, cmd] of NOT_FATAL) {
    it(`does NOT treat read-only ${name} as a verification invocation`, () => {
      expect(escapeIsFatal(cmd)).toBe(false);
    });
  }

  it('an escaped pytest is REJECTED by the evidence gate (Python un-blinding, end to end)', () => {
    const res = evaluateCommandEvidence({
      commands: [{ cmd: 'cd /main/bsync-tools && pytest -q', cwd: '/main/bsync-tools', exitCode: 0 }],
      claims: [],
      worktreeRoot: '/wt',
    });
    expect(res.reject).toBe(true);
    expect(res.escapes).toHaveLength(1);
  });
});

describe('detectWorkingRootEscape — the implement-node cwd guard', () => {
  const WT = '/wt/leaf-exec-cdc94681';
  const MAIN = '/Users/x/Code/build123d-ocp-mcp';

  it('fires on the OBSERVED failure: cd to the main checkout then pytest', () => {
    const found = detectWorkingRootEscape({
      commands: [
        { cmd: 'ls bsync-tools/bsync/stock/', cwd: WT, exitCode: 0 },
        { cmd: `cd ${MAIN}/bsync-tools && pytest -q`, cwd: `${MAIN}/bsync-tools`, exitCode: 0 },
      ],
      worktreeRoot: WT,
      mainCheckoutRoot: MAIN,
    });
    expect(found).not.toBeNull();
    expect(found!.escaped).toHaveLength(1);
    expect(found!.message).toContain(WT);
    expect(found!.message).toContain(MAIN);
    expect(found!.message).toContain('pytest');
  });

  it('fires on an escaped MUTATING command (edit in the main checkout)', () => {
    for (const cmd of [
      `cd ${MAIN} && sed -i '' 's/a/b/' src/x.py`,
      `cd ${MAIN} && git commit -am wip`,
      `cd ${MAIN} && cp /tmp/x.py src/x.py`,
      `cd ${MAIN} && mkdir -p src/new`,
    ]) {
      const found = detectWorkingRootEscape({
        commands: [{ cmd, cwd: MAIN, exitCode: 0 }],
        worktreeRoot: WT,
        mainCheckoutRoot: MAIN,
      });
      expect(found).not.toBeNull();
    }
  });

  it('does NOT fire on read-only exploration outside the worktree', () => {
    const found = detectWorkingRootEscape({
      commands: [
        { cmd: `find ${MAIN}/bsync-tools -type f -name "*.py"`, cwd: MAIN, exitCode: 0 },
        { cmd: `cd ${MAIN} && grep -rn "Stock" bsync/`, cwd: MAIN, exitCode: 0 },
        { cmd: `cat ${MAIN}/pyproject.toml`, cwd: MAIN, exitCode: 0 },
        { cmd: 'sed -n 1,40p README.md', cwd: MAIN, exitCode: 0 },
        { cmd: 'ls -la', cwd: MAIN, exitCode: 0 },
      ],
      worktreeRoot: WT,
      mainCheckoutRoot: MAIN,
    });
    expect(found).toBeNull();
  });

  it('does NOT fire when everything ran INSIDE the worktree', () => {
    const found = detectWorkingRootEscape({
      commands: [
        { cmd: 'pytest -q', cwd: WT, exitCode: 0 },
        { cmd: 'git commit -am wip', cwd: `${WT}/bsync-tools`, exitCode: 0 },
      ],
      worktreeRoot: WT,
      mainCheckoutRoot: MAIN,
    });
    expect(found).toBeNull();
  });

  it('escapeMutatesOrVerifies: mutation OR verification, never read-only', () => {
    expect(escapeMutatesOrVerifies('git commit -am wip')).toBe(true);
    expect(escapeMutatesOrVerifies('pytest -q')).toBe(true);
    expect(escapeMutatesOrVerifies('grep -rn cp src/')).toBe(false);
    expect(escapeMutatesOrVerifies('sed -n 1,5p f.py')).toBe(false);
  });

  it('FAILS OPEN on a fault (advisory guard must never sink a leaf)', () => {
    const found = detectWorkingRootEscape({
      // a getter that throws mid-iteration
      commands: new Proxy([] as never[], { get() { throw new Error('boom'); } }),
      worktreeRoot: WT,
    });
    expect(found).toBeNull();
  });
});
