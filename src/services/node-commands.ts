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

export interface CommandEvidence {
  escapes: RecordedCommand[];
  unbackedClaims: string[];
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

  return claims;
}

/**
 * Normalize whitespace in a command string for matching.
 */
function normalizeCommand(cmd: string): string {
  return cmd.replace(/\s+/g, ' ').trim();
}

/**
 * Check if a claim matches a recorded command.
 * Matching: normalise whitespace, then check if one string contains the other.
 */
function claimMatches(claim: string, recorded: RecordedCommand): boolean {
  const normClaim = normalizeCommand(claim);
  const normCmd = normalizeCommand(recorded.cmd);
  return normCmd.includes(normClaim) || normClaim.includes(normCmd);
}

/**
 * Evaluate command evidence against recorded commands and reviewer claims.
 * Returns escapes and unbacked claims; reject iff escapes exist OR policy is 'reject' and claims are unbacked.
 */
export function evaluateCommandEvidence(opts: {
  commands: RecordedCommand[];
  claims: string[];
  worktreeRoot: string;
}): CommandEvidence {
  const { commands, claims, worktreeRoot } = opts;
  const escapes: RecordedCommand[] = [];
  const reasons: string[] = [];

  // Check for cwd escapes
  for (const cmd of commands) {
    if (isCwdEscape(cmd.cwd, worktreeRoot)) {
      escapes.push(cmd);
      reasons.push(`command "${cmd.cmd}" ran outside worktree: ${cmd.cwd}`);
    }
  }

  // Check for unbacked claims
  const unbackedClaims: string[] = [];
  for (const claim of claims) {
    const matched = commands.some((cmd) => claimMatches(claim, cmd));
    if (!matched) {
      unbackedClaims.push(claim);
      reasons.push(`claim unbacked: no recorded command matched "${claim}"`);
    }
  }

  const reject = escapes.length > 0 || (UNBACKED_CLAIM_POLICY === 'reject' && unbackedClaims.length > 0);

  return { escapes, unbackedClaims, reject, reasons };
}
