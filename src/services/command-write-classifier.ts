/**
 * Per-segment command write classifier: splits a command on segment operators
 * (`;`, `&&`, `||`, `|`), tracks cwd changes from `cd` commands, and collects
 * write targets (from WRITE_VERBS and redirects). All paths are resolved to
 * absolute based on the cwd in effect when each segment runs.
 *
 * Quote-aware: does not split inside single or double quotes, matching the
 * behavior of splitCommandClauses (node-commands.ts:295).
 */

import { isAbsolute, relative, resolve } from 'node:path';

export const WRITE_VERBS = new Set(['cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'tee', 'install', 'ln', 'dd', 'chown', 'chmod', 'patch']);
export const READ_VERBS = new Set(['find', 'grep', 'rg', 'ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'tree', 'which', 'echo', 'pwd']);

const GIT_WRITE_SUBCOMMANDS = new Set(['commit', 'add', 'apply', 'checkout', 'restore', 'rm', 'mv', 'stash', 'switch', 'reset', 'clean']);
const GIT_READ_SUBCOMMANDS = new Set(['grep', 'log', 'diff', 'status', 'show', 'rev-parse', 'ls-files']);

/** Git subcommands that mutate worktree/index state (not merely the object store). */
export const GIT_WORKTREE_MUTATING_SUBCOMMANDS = new Set([
  'stash',
  'checkout',
  'switch',
  'reset',
  'clean',
  'restore',
]);

interface WriteSegment {
  text: string;
}

/**
 * Split a command into segments on `;`, `&&`, `||`, `|`, respecting quotes.
 * Unlike splitCommandClauses (which treats pipes as one clause), this splits on
 * all four operators including pipes.
 *
 * Returns the text of each segment (operators stripped).
 */
function splitWriteSegments(cmd: string): WriteSegment[] {
  const segments: WriteSegment[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

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
      const text = current.trim();
      if (text) {
        segments.push({ text });
      }
      current = '';
      i++; // skip the second char
      continue;
    }

    // Check for single-char `;` or `|`
    if (char === ';' || char === '|') {
      const text = current.trim();
      if (text) {
        segments.push({ text });
      }
      current = '';
      continue;
    }

    current += char;
  }

  // Add the last segment if any
  const text = current.trim();
  if (text) {
    segments.push({ text });
  }

  return segments;
}

/**
 * Extract non-flag arguments from a tokenized command.
 * Drops the leading verb and any tokens starting with `-`.
 */
function nonFlagArgs(tokens: string[]): string[] {
  return tokens.slice(1).filter((t) => !t.startsWith('-'));
}

/**
 * Tokenize a command string after stripping quoted substrings, preserving
 * the leading verb.
 *
 * Strips quoted substrings (both single and double) for the purpose of
 * detecting the verb and flags, but non-flag arguments are returned
 * unmodified (with their quotes intact) so cwd-relative resolution
 * can handle them correctly.
 */
function tokenizeForVerb(segment: string): string[] {
  // Strip quoted substrings for tokenization
  const unquoted = segment.replace(/'[^']*'|"[^"]*"/g, ' ');

  // Tokenize on whitespace
  const tokens = unquoted.split(/\s+/).filter((t) => t.length > 0);

  return tokens;
}

/**
 * Extract argument targets from a segment, preserving quotes for cwd resolution.
 */
function extractArgumentTargets(segment: string, tokens: string[]): string[] {
  const args = nonFlagArgs(tokens);
  const targets: string[] = [];

  // For each argument, find it in the original segment (this is a simplification
  // that works for most cases; we just take the non-flag args directly)
  // Since we've stripped quotes to get tokens, we need to find the unquoted versions
  // in the original segment and grab them with quotes intact.

  // Simpler approach: extract arguments from the original segment by re-tokenizing
  // with a quote-preserving tokenizer.
  let i = 0;
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let foundVerb = false;
  let argCount = 0;

  for (let idx = 0; idx < segment.length; idx++) {
    const char = segment[idx];
    const next = segment[idx + 1];

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

    if (inSingleQuote || inDoubleQuote) {
      current += char;
      continue;
    }

    if (/\s/.test(char)) {
      const trimmed = current.trim();
      if (trimmed) {
        if (!foundVerb) {
          foundVerb = true; // Skip the first token (verb)
        } else if (!trimmed.startsWith('-')) {
          targets.push(trimmed);
          argCount++;
        }
      }
      current = '';
      continue;
    }

    current += char;
  }

  // Don't forget the last token
  const trimmed = current.trim();
  if (trimmed && foundVerb && !trimmed.startsWith('-')) {
    targets.push(trimmed);
  }

  return targets;
}

/**
 * Strip quotes from a path for resolution.
 */
function stripQuotes(path: string): string {
  if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
    return path.slice(1, -1);
  }
  return path;
}

/**
 * True when `cwd` is `root` itself or a path under it (string path math only).
 * Same shape as node-commands.ts containment checks.
 */
function isPathContainedIn(root: string, cwd: string): boolean {
  const rel = relative(root, cwd);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

interface SegmentWalkEntry {
  text: string;
  tokens: string[];
  verb: string;
  cwd: string;
}

/**
 * Yield one entry per non-empty segment with the running cwd already advanced
 * by any preceding `cd` segment. For a `cd` segment itself, `cwd` is the
 * POST-`cd` path (so redirect targets resolve against it).
 */
function* iterateSegments(cmd: string, cwd: string): Iterable<SegmentWalkEntry> {
  const segments = splitWriteSegments(cmd);
  let runningCwd = cwd;

  for (const seg of segments) {
    const tokens = tokenizeForVerb(seg.text);
    if (tokens.length === 0) continue;

    const verb = tokens[0]!;

    // Handle cd: update running cwd before yielding (POST-cd for this segment)
    if (verb === 'cd') {
      if (tokens[1]) {
        const path = stripQuotes(tokens[1]);
        if (path && path !== '~' && !path.startsWith('$')) {
          runningCwd = resolve(runningCwd, path);
        }
      }
    }

    yield { text: seg.text, tokens, verb, cwd: runningCwd };
  }
}

/**
 * Classify command writes, tracking cwd changes and resolving all paths to absolute.
 *
 * Returns an object with `targets` array containing all absolute paths that are
 * written to by this command (from WRITE_VERBS, special-cased verbs, and redirects).
 */
export function classifyCommandWrites(cmd: string, cwd: string): { targets: string[] } {
  const allTargets = new Set<string>();

  for (const seg of iterateSegments(cmd, cwd)) {
    const { text, tokens, verb, cwd: runningCwd } = seg;

    // Handle cd: update running cwd but don't contribute targets
    // (cwd already advanced by iterateSegments; collect redirect targets only)
    if (verb === 'cd') {
      // Still collect redirect targets after cd
      for (const m of text.matchAll(/(?:^|[\s>])>{1,2}\s*([^\s;&|)'"\n]+)/g)) {
        if (m[1]) {
          const resolved = resolve(runningCwd, m[1]);
          allTargets.add(resolved);
        }
      }
      continue;
    }

    // Handle git: check subcommand
    if (verb === 'git') {
      const subCmd = tokens[1];
      if (subCmd && !GIT_WRITE_SUBCOMMANDS.has(subCmd) && !GIT_READ_SUBCOMMANDS.has(subCmd)) {
        // Unrecognized git subcommand, skip
        continue;
      }
      if (subCmd && GIT_READ_SUBCOMMANDS.has(subCmd)) {
        // Read-only git command, skip argument collection
        // But still collect redirects
        for (const m of text.matchAll(/(?:^|[\s>])>{1,2}\s*([^\s;&|)'"\n]+)/g)) {
          if (m[1]) {
            const resolved = resolve(runningCwd, m[1]);
            allTargets.add(resolved);
          }
        }
        continue;
      }
      // For write subcommands, collect argument targets
      if (subCmd && GIT_WRITE_SUBCOMMANDS.has(subCmd)) {
        const args = extractArgumentTargets(text, tokens);
        for (const arg of args) {
          const resolved = resolve(runningCwd, stripQuotes(arg));
          allTargets.add(resolved);
        }
      }
      // Collect redirects for git commands too
      for (const m of text.matchAll(/(?:^|[\s>])>{1,2}\s*([^\s;&|)'"\n]+)/g)) {
        if (m[1]) {
          const resolved = resolve(runningCwd, m[1]);
          allTargets.add(resolved);
        }
      }
      continue;
    }

    // Handle sed: special-cased on flags
    if (verb === 'sed') {
      const flags = tokens.slice(1).join(' ');
      const hasInPlace = /-i/.test(flags);
      const hasReadOnly = /-n/.test(flags);

      if (hasInPlace) {
        // sed -i is a WRITE
        const args = extractArgumentTargets(text, tokens);
        for (const arg of args) {
          const resolved = resolve(runningCwd, stripQuotes(arg));
          allTargets.add(resolved);
        }
      }
      // Collect redirects for sed commands
      for (const m of text.matchAll(/(?:^|[\s>])>{1,2}\s*([^\s;&|)'"\n]+)/g)) {
        if (m[1]) {
          const resolved = resolve(runningCwd, m[1]);
          allTargets.add(resolved);
        }
      }
      continue;
    }

    // Standard WRITE_VERBS / READ_VERBS classification
    if (WRITE_VERBS.has(verb)) {
      // Collect argument targets for write verbs
      const args = extractArgumentTargets(text, tokens);
      for (const arg of args) {
        const resolved = resolve(runningCwd, stripQuotes(arg));
        allTargets.add(resolved);
      }
    } else if (READ_VERBS.has(verb)) {
      // READ verb: no argument collection
      // But still collect redirects (e.g., echo > /etc/file)
    }
    // Unrecognized verb: no targets

    // Collect redirect targets from ALL segments, regardless of verb
    // Pattern: >, >>, or > followed by a path
    for (const m of text.matchAll(/(?:^|[\s>])>{1,2}\s*([^\s;&|)'"\n]+)/g)) {
      if (m[1]) {
        const resolved = resolve(runningCwd, m[1]);
        allTargets.add(resolved);
      }
    }
  }

  return { targets: [...allTargets] };
}

/**
 * Pure predicate: detect a git worktree-state mutation whose running cwd resolves
 * to the main checkout (or under it) and is NOT contained in the leaf worktree.
 * Fail-safe: any fault returns null.
 */
export function detectMainCheckoutGitMutation(opts: {
  cmd: string;
  cwd: string;
  mainCheckoutRoot?: string | null;
  worktreeRoot?: string | null;
}): { subcommand: string; segment: string; resolvedCwd: string; message: string } | null {
  try {
    const mainRoot = opts.mainCheckoutRoot;
    if (!mainRoot || typeof mainRoot !== 'string' || mainRoot.length === 0) {
      return null;
    }

    const mainAbs = resolve(mainRoot);
    const worktreeAbs =
      opts.worktreeRoot && typeof opts.worktreeRoot === 'string' && opts.worktreeRoot.length > 0
        ? resolve(opts.worktreeRoot)
        : null;

    for (const seg of iterateSegments(opts.cmd, opts.cwd)) {
      const resolvedCwd = resolve(seg.cwd);

      if (!isPathContainedIn(mainAbs, resolvedCwd)) continue;
      if (worktreeAbs && isPathContainedIn(worktreeAbs, resolvedCwd)) continue;

      if (seg.verb !== 'git') continue;
      const subcommand = seg.tokens[1];
      if (!subcommand || !GIT_WORKTREE_MUTATING_SUBCOMMANDS.has(subcommand)) continue;

      return {
        subcommand,
        segment: seg.text,
        resolvedCwd,
        message:
          `main-checkout-git-mutation: \`git ${subcommand}\` would run with cwd ${resolvedCwd}, ` +
          `which is the repository's MAIN checkout (or under it). ` +
          `This leaf holds no privilege to mutate the main checkout.`,
      };
    }

    return null;
  } catch {
    return null;
  }
}
