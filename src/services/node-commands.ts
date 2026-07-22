/**
 * Command evidence gate (C2) — record node commands, detect cwd escapes, verify reviewer claims.
 *
 * A leaf can go GREEN on evidence that does not exist. The executor already spawns every
 * node itself and captures the full stream-json transcript. This module reads the transcript,
 * extracts the commands that actually ran (at the spawn boundary), and gates acceptance on
 * both a cwd-escape check (REJECT) and a verification-claim match (WARN until A2 lands).
 *
 * Pure, domain-free, no I/O except realpathSync in the escape predicate (mirrors
 * review-citations.ts's posture: the executor calls it, it decides nothing about semantics).
 */

import { realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

export interface RecordedCommand {
  cmd: string;
  cwd: string;
  exitCode: number | null;
}

/** WARN vs REJECT for a claim with no matching recorded command.
 *  'warn' until sibling leaf A2 lands `ui/node_modules` in worktrees — a worktree
 *  genuinely cannot run the UI suite today, so rejecting would fail CORRECT leaves.
 *  Flip to 'reject' after A2. One line. */
export const UNBACKED_CLAIM_POLICY: 'warn' | 'reject' = 'warn';

/** A criterion/claim that names a read-only command AND asserts its ABSENCE result
 *  (e.g. "grep -c OrchestratorLadder Foo.tsx returns 0"). command = the command to
 *  match against recorded commands; assertsAbsence = the criterion claims 0 matches. */
export interface ResultAssertion {
  command: string;
  assertsAbsence: boolean;
}

export interface CommandEvidence {
  escapes: RecordedCommand[];
  unbackedClaims: string[];
  contradictedClaims: string[];
  reject: boolean;
  reasons: string[];
}

/**
 * Line-scan the stream-json JSONL. Extract tool_use (Bash) and tool_result messages.
 *  - tool_use with name==='Bash' → extract command and id
 *  - tool_result matched by tool_use_id → extract exit code
 *  - Resolved cwd: specCwd unless the command opens with `cd <path>`
 *
 * Returns at most 200 commands (defensive). Unparseable lines are ignored.
 */
export function parseNodeCommands(stdout: string, specCwd: string): RecordedCommand[] {
  const commands: RecordedCommand[] = [];
  const MAX_COMMANDS = 200;

  // Map tool_use id → command for later matching with tool_result
  const bashToolUses = new Map<string, { cmd: string }>();

  for (const line of stdout.split('\n')) {
    if (commands.length >= MAX_COMMANDS) break;

    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // ignore unparseable lines (truncated transcript)
    }

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && block.name === 'Bash') {
          const cmd = block.input?.command;
          if (cmd && typeof cmd === 'string') {
            bashToolUses.set(block.id, { cmd });
          }
        }
      }
    }

    if (msg.type === 'user' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const tool = bashToolUses.get(block.tool_use_id);
          if (!tool) continue;

          const cmd = tool.cmd;
          let exitCode: number | null = null;

          // Parse exit code from result text or is_error flag
          const resultText = block.content?.[0]?.text ?? '';
          const exitMatch = resultText.match(/exit code[:\s]+(\d+)/i);
          if (exitMatch) {
            exitCode = Number(exitMatch[1]);
          } else if (block.is_error) {
            exitCode = 1;
          } else {
            exitCode = 0;
          }

          // Resolve cwd: check if command opens with `cd <path>`
          const resolvedCwd = resolveCwdFromCommand(cmd, specCwd);

          commands.push({ cmd, cwd: resolvedCwd, exitCode });
        }
      }
    }
  }

  return commands;
}

/**
 * Extract the resolved cwd from a command that may start with `cd <path>`.
 * Pattern: `/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;|$)/`
 */
function resolveCwdFromCommand(cmd: string, specCwd: string): string {
  const cdMatch = cmd.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;|$)/);
  if (!cdMatch) return specCwd;

  let path = cdMatch[1];
  // Remove surrounding quotes
  if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
    path = path.slice(1, -1);
  }

  // Skip special cases (no argument, ~, $VAR)
  if (!path || path === '~' || path.startsWith('$')) {
    return specCwd;
  }

  return resolve(specCwd, path);
}

/**
 * Check if a resolved command cwd escapes the worktree root.
 * Both sides are realpath'd; relative path must not start with '..' or be absolute
 * and outside the worktree (after accounting for symlinks).
 */
export function isCwdEscape(commandCwd: string, worktreeRoot: string): boolean {
  let realCwd: string;
  let realRoot: string;

  try {
    realCwd = realpathSync(commandCwd);
  } catch {
    // Unresolvable cwd — fall back to resolve() and proceed
    realCwd = resolve(commandCwd);
  }

  try {
    realRoot = realpathSync(worktreeRoot);
  } catch {
    // Unresolvable root — fall back to resolve() and proceed
    realRoot = resolve(worktreeRoot);
  }

  const rel = relative(realRoot, realCwd);
  // Escape if relative path is empty (cwd !== root but can't resolve diff),
  // or starts with '..' (parent directory), or is absolute and outside the root.
  return rel !== '' && (rel.startsWith('..') || isAbsolute(rel));
}

/**
 * Parse verification claims from the review text.
 * A claim is a structured line: `- ran: <exact command>`
 * Appears after a `VERIFICATION:` heading in the review text.
 * Also harvests result-assertion claims from criteria (e.g. "grep returns 0").
 */
export function parseVerificationClaims(criteria: any[], reviewText: string): string[] {
  const claims: string[] = [];

  // Find the VERIFICATION: block
  const lines = reviewText.split('\n');
  let inVerificationBlock = false;

  for (const line of lines) {
    if (/^\s*VERIFICATION\s*:\s*$/i.test(line)) {
      inVerificationBlock = true;
      continue;
    }

    if (inVerificationBlock) {
      // Stop if we hit another heading (starts with # or a dash/bracket at line start for criteria)
      if (/^#+\s|^\[/.test(line)) {
        break;
      }

      const match = line.match(/^\s*[-*]?\s*ran:\s*(.+)$/i);
      if (match) {
        claims.push(match[1].trim());
      }
    }
  }

  // Harvest result-assertion claims from criteria
  for (const c of criteria ?? []) {
    const t = typeof c === 'string' ? c : (c?.text ?? '');
    if (typeof t === 'string' && parseResultAssertion(t)) {
      claims.push(t.trim());
    }
  }

  return claims;
}

/**
 * Normalize whitespace in a command string for matching.
 */
function normalizeCommand(cmd: string): string {
  return cmd.replace(/\s+/g, ' ').trim();
}

/** Absence phrasing: "returns 0", "→ 0", "0 matches", "no matches", "exits non-zero". */
export const ABSENCE_RESULT =
  /(?:returns?\s+0|→\s*0|produces?\s+0|0\s+match(?:es)?|no\s+match(?:es)?|exits?\s+non-?zero)/i;

/** Detect a grep/rg count command paired with an absence assertion inside one line of
 *  text. Returns the extracted command + assertsAbsence, or null when the text is not a
 *  result-assertion claim (leaves every existing plain "ran:" claim on the old path). */
export function parseResultAssertion(text: string): ResultAssertion | null {
  if (!ABSENCE_RESULT.test(text)) return null;
  // Prefer a backticked command; else grab the grep/rg invocation up to the assertion phrase.
  const backtick = text.match(/`([^`]*\b(?:grep|rg|git\s+grep)\b[^`]*)`/i);
  let command = backtick?.[1];
  if (!command) {
    const inline = text.match(
      /\b((?:grep|rg|git\s+grep)\b[^`\n]*?)(?=\s+(?:returns?|→|produces?|0\s+match|no\s+match|exits?\s+non|,|;|\.|$))/i,
    );
    command = inline?.[1];
  }
  if (!command || !command.trim()) return null;
  return { command: command.trim(), assertsAbsence: true };
}

/**
 * Check if a claim matches a command text.
 * Matching: normalise whitespace, then check if one string contains the other.
 */
function commandTextMatches(claim: string, cmdText: string): boolean {
  const normClaim = normalizeCommand(claim);
  const normCmd = normalizeCommand(cmdText);
  return normCmd.includes(normClaim) || normClaim.includes(normCmd);
}

/**
 * Check if a claim matches a recorded command.
 * Matching: normalise whitespace, then check if one string contains the other.
 */
function claimMatches(claim: string, recorded: RecordedCommand): boolean {
  return commandTextMatches(claim, recorded.cmd);
}

/**
 * A cwd-escape only FAKES EVIDENCE when the escaped command is a build/test/verification run —
 * it could report a green from the MAIN checkout instead of the worktree (the exact false-green
 * this gate exists to stop). A read-only diagnostic that escaped (grep/find/ls/cat/sed -n while a
 * node explores the wider repo) backs no criterion and is harmless; rejecting the whole leaf over
 * it discards CORRECT code. So an escape is fatal ONLY for a verification invocation.
 */
const VERIFICATION_INVOCATION =
  /(?:^|[\s;&|`(])(?:tsc|vitest|jest|mocha|eslint|playwright|cypress)\b|(?:^|[\s;&|`(])(?:npm|npx|bun|pnpm|yarn|make|cargo|go)\s+(?:run|test|build|ci|install|exec)\b/i;
/** True when a recorded command chains multiple clauses (`;`, `&&`, `||`, pipes are
 *  fine — a pipe is one pipeline with one meaningful exit). Only chain operators make
 *  the single recorded exitCode unattributable to an individual claim's clause. */
export function isCompoundCommand(cmd: string): boolean {
  return /(?:;|&&|\|\|)/.test(cmd);
}

export interface CommandClause {
  text: string;
  operator: '&&' | '||' | ';' | null;
}

/**
 * Split a command into clauses, tracking the operator that precedes each.
 * Respects single and double quotes; does not split on operators inside quotes.
 * Pipe (|) is NOT a clause separator (pipelines are one clause).
 * Returns clauses with operator=null for the first, or the preceding operator for others.
 */
export function splitCommandClauses(cmd: string): CommandClause[] {
  const clauses: CommandClause[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let nextOperator: '&&' | '||' | ';' | null = null;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];
    const next = cmd[i + 1];

    // Track quote state
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    // If inside quotes, just accumulate
    if (inSingleQuote || inDoubleQuote) {
      current += char;
      continue;
    }

    // Check for 2-char operators: && or ||
    if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
      const operator = char === '&' ? ('&&' as const) : ('||' as const);
      const text = current.trim();
      if (text) {
        clauses.push({ text, operator: nextOperator });
        nextOperator = operator;
      }
      current = '';
      i++; // skip the second char
      continue;
    }

    // Check for single-char `;`
    if (char === ';') {
      const text = current.trim();
      if (text) {
        clauses.push({ text, operator: nextOperator });
        nextOperator = ';';
      }
      current = '';
      continue;
    }

    current += char;
  }

  // Add the last clause if any
  const text = current.trim();
  if (text) {
    clauses.push({ text, operator: nextOperator });
  }

  // Ensure first clause has null operator
  if (clauses.length > 0) {
    clauses[0].operator = null;
  }

  return clauses;
}

/**
 * Returns the exit code attributable to a specific clause, or null for UNKNOWN.
 * - If overallExit === null → null (nothing is known).
 * - If all clauses are joined by &&, and overallExit === 0 → 0 for any clause
 *   (an && chain completing with 0 means all clauses succeeded).
 * - If targetIndex is the final clause → overallExit (final clause always carries the command's exit).
 * - Else → null (non-final clause in a ; or || chain, or non-final && with non-zero overall).
 */
export function attributeClauseExit(
  clauses: CommandClause[],
  targetIndex: number,
  overallExit: number | null,
): number | null {
  if (overallExit === null) return null;

  const isPureAndChain = clauses.every((c, i) => i === 0 || c.operator === '&&');

  if (isPureAndChain && overallExit === 0) {
    return 0;
  }

  if (targetIndex === clauses.length - 1) {
    return overallExit;
  }

  return null;
}

/**
 * Extract the scope (trailing path/target arguments) from a command.
 * Strips quoted substrings, tokenizes on whitespace, drops command name and flags (leading -).
 * E.g., "grep -rn 'X' src/routes/" → "src/routes/"
 */
export function extractCommandScope(cmd: string): string {
  // Strip quoted substrings
  const unquoted = cmd.replace(/'[^']*'|"[^"]*"/g, ' ');

  // Tokenize on whitespace
  const tokens = unquoted.split(/\s+/).filter((t) => t.length > 0);

  // Drop the first token (command name) and any token starting with `-` (flags)
  const scopeTokens = tokens.slice(1).filter((t) => !t.startsWith('-'));

  return scopeTokens.join(' ');
}

export function escapeIsFatal(cmd: string): boolean {
  return VERIFICATION_INVOCATION.test(cmd);
}

/**
 * Evaluate command evidence against recorded commands and reviewer claims.
 * Returns escapes and unbacked claims; reject iff a VERIFICATION-command escape exists OR policy
 * is 'reject' and claims are unbacked, OR a result-assertion claim is contradicted by the
 * recorded exitCode. A read-only diagnostic escape is recorded but non-fatal.
 */
export function evaluateCommandEvidence(opts: {
  commands: RecordedCommand[];
  claims: string[];
  worktreeRoot: string;
}): CommandEvidence {
  const { commands, claims, worktreeRoot } = opts;
  const escapes: RecordedCommand[] = [];
  const contradictedClaims: string[] = [];
  const reasons: string[] = [];

  // A verification escape only fakes evidence if the work was NEVER verified in the worktree.
  // The subset-of-baseline verdict REQUIRES running the suite in the base (master) checkout to
  // collect the baseline failing-name set — a legitimate outside-worktree verification run. When
  // the leaf ALSO ran verification INSIDE the worktree, the outside run is a baseline, not a
  // false-green: the in-worktree run is the authoritative evidence and the escape cannot fake it.
  // So downgrade escaped verifications to non-fatal iff an in-worktree verification exists.
  const hasInWorktreeVerification = commands.some(
    (c) => !isCwdEscape(c.cwd, worktreeRoot) && escapeIsFatal(c.cmd),
  );

  // Check for cwd escapes — a verification-command escape is fatal ONLY when nothing verified the
  // work in the worktree (otherwise it is a baseline run beside real in-worktree verification).
  for (const cmd of commands) {
    if (isCwdEscape(cmd.cwd, worktreeRoot)) {
      if (escapeIsFatal(cmd.cmd) && !hasInWorktreeVerification) {
        escapes.push(cmd);
        reasons.push(`verification command "${cmd.cmd}" ran outside worktree with NO in-worktree verification: ${cmd.cwd}`);
      } else if (escapeIsFatal(cmd.cmd)) {
        reasons.push(`note: verification ran outside worktree but in-worktree verification exists (baseline, non-fatal): ${cmd.cwd}`);
      } else {
        reasons.push(`note: read-only command ran outside worktree (non-fatal): ${cmd.cwd}`);
      }
    }
  }

  // Check claims: branch on result-assertion vs plain claim path
  const unbackedClaims: string[] = [];
  for (const claim of claims) {
    const ra = parseResultAssertion(claim);
    if (ra) {
      // Search for a matching clause in any recorded command
      let matchedRec: RecordedCommand | undefined;
      let matchedClauses: CommandClause[] | undefined;
      let matchedIndex: number = -1;

      for (const rec of commands) {
        const clauses = splitCommandClauses(rec.cmd);
        for (let i = 0; i < clauses.length; i++) {
          if (commandTextMatches(ra.command, clauses[i].text)) {
            matchedRec = rec;
            matchedClauses = clauses;
            matchedIndex = i;
            break;
          }
        }
        if (matchedRec) break;
      }

      if (!matchedRec) {
        unbackedClaims.push(claim);
        reasons.push(`claim unbacked: no recorded command matched "${ra.command}"`);
      } else if (ra.assertsAbsence) {
        // Check scope match
        const claimScope = extractCommandScope(ra.command);
        const cmdScope = extractCommandScope(matchedClauses![matchedIndex].text);

        if (claimScope !== cmdScope) {
          unbackedClaims.push(claim);
          reasons.push(
            `claim unbacked (scope mismatch): "${claim}" targets "${claimScope}" but matched clause targets "${cmdScope}"`,
          );
        } else {
          // Scopes agree — check exit code attribution
          const attributedExit = attributeClauseExit(matchedClauses!, matchedIndex, matchedRec.exitCode);

          if (attributedExit === 0) {
            contradictedClaims.push(claim);
            reasons.push(
              `claim contradicted: "${claim}" asserts absence but recorded "${matchedClauses![matchedIndex].text}" exits 0 (matches found)`,
            );
          } else if (attributedExit === null) {
            unbackedClaims.push(claim);
            reasons.push(
              `claim unbacked (compound exit unattributable): "${claim}" asserts absence but the matching clause's exit code cannot be attributed in its compound command`,
            );
          }
          // else: attributedExit is a known non-zero → absence BACKED → nothing to record
        }
      }
      // else: recorded command exited non-zero → absence BACKED → nothing to record.
      continue;
    }
    const matched = commands.some((cmd) => claimMatches(claim, cmd));
    if (!matched) {
      unbackedClaims.push(claim);
      reasons.push(`claim unbacked: no recorded command matched "${claim}"`);
    }
  }

  const reject =
    escapes.length > 0 ||
    contradictedClaims.length > 0 ||
    (UNBACKED_CLAIM_POLICY === 'reject' && unbackedClaims.length > 0);

  return { escapes, unbackedClaims, contradictedClaims, reject, reasons };
}
