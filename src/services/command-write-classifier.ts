/**
 * Per-segment command write classifier: splits a command on segment operators
 * (`;`, `&&`, `||`, `|`), tracks cwd changes from `cd` commands, and collects
 * write targets (from WRITE_VERBS and redirects). All paths are resolved to
 * absolute based on the cwd in effect when each segment runs.
 *
 * Quote-aware: does not split inside single or double quotes, matching the
 * behavior of splitCommandClauses (node-commands.ts:295).
 */

import { resolve } from 'node:path';

export const WRITE_VERBS = new Set(['cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'tee', 'install', 'ln', 'dd', 'chown', 'chmod', 'patch']);
export const READ_VERBS = new Set(['find', 'grep', 'rg', 'ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'tree', 'which', 'echo', 'pwd']);

const GIT_WRITE_SUBCOMMANDS = new Set(['commit', 'add', 'apply', 'checkout', 'restore', 'rm', 'mv', 'stash']);
const GIT_READ_SUBCOMMANDS = new Set(['grep', 'log', 'diff', 'status', 'show', 'rev-parse', 'ls-files']);

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
 * Classify command writes, tracking cwd changes and resolving all paths to absolute.
 *
 * Returns an object with `targets` array containing all absolute paths that are
 * written to by this command (from WRITE_VERBS, special-cased verbs, and redirects).
 */
export function classifyCommandWrites(cmd: string, cwd: string): { targets: string[] } {
  const segments = splitWriteSegments(cmd);
  const allTargets = new Set<string>();
  let runningCwd = cwd;

  for (const seg of segments) {
    const tokens = tokenizeForVerb(seg.text);
    if (tokens.length === 0) continue;

    const verb = tokens[0];

    // Handle cd: update running cwd but don't contribute targets
    if (verb === 'cd') {
      if (tokens[1]) {
        const path = stripQuotes(tokens[1]);
        if (path && path !== '~' && !path.startsWith('$')) {
          runningCwd = resolve(runningCwd, path);
        }
      }
      // Still collect redirect targets after cd
      for (const m of seg.text.matchAll(/(?:^|[\s>])>{1,2}\s*([^\s;&|)'"\n]+)/g)) {
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
        for (const m of seg.text.matchAll(/(?:^|[\s>])>{1,2}\s*([^\s;&|)'"\n]+)/g)) {
          if (m[1]) {
            const resolved = resolve(runningCwd, m[1]);
            allTargets.add(resolved);
          }
        }
        continue;
      }
      // For write subcommands, collect argument targets
      if (subCmd && GIT_WRITE_SUBCOMMANDS.has(subCmd)) {
        const args = extractArgumentTargets(seg.text, tokens);
        for (const arg of args) {
          const resolved = resolve(runningCwd, stripQuotes(arg));
          allTargets.add(resolved);
        }
      }
      // Collect redirects for git commands too
      for (const m of seg.text.matchAll(/(?:^|[\s>])>{1,2}\s*([^\s;&|)'"\n]+)/g)) {
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
        const args = extractArgumentTargets(seg.text, tokens);
        for (const arg of args) {
          const resolved = resolve(runningCwd, stripQuotes(arg));
          allTargets.add(resolved);
        }
      }
      // Collect redirects for sed commands
      for (const m of seg.text.matchAll(/(?:^|[\s>])>{1,2}\s*([^\s;&|)'"\n]+)/g)) {
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
      const args = extractArgumentTargets(seg.text, tokens);
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
    for (const m of seg.text.matchAll(/(?:^|[\s>])>{1,2}\s*([^\s;&|)'"\n]+)/g)) {
      if (m[1]) {
        const resolved = resolve(runningCwd, m[1]);
        allTargets.add(resolved);
      }
    }
  }

  return { targets: [...allTargets] };
}
