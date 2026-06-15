/**
 * grep / glob — pure-Node worktree search (no ripgrep dependency).
 *
 * Chosen over a bundled rg binary deliberately: zero new dependency, works in any
 * runtime, and testable without a binary. The model still has run_bash for heavier
 * search if the host provides rg/grep. Output is capped so a broad pattern can't
 * flood the context.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Directories never descended into. */
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.collab']);
const MAX_RESULTS = 200;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LINE_LEN = 300;

function* walkFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) yield* walkFiles(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

/** Translate a glob (`**` across dirs, `*` within a segment, `?` one char) to an
 *  anchored RegExp matched against a worktree-relative path. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // consume the slash after **
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

/** Search file CONTENTS for `pattern` (a regex), optionally restricted to files
 *  matching `glob`. Returns relative-path matches, capped. */
export function grepOp(
  cwd: string,
  pattern: string,
  opts: { glob?: string } = {},
): { matches: GrepMatch[]; truncated: boolean } | { error: string } {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return { error: `invalid regex: ${pattern}` };
  }
  const globRe = opts.glob ? globToRegExp(opts.glob) : null;
  const matches: GrepMatch[] = [];
  for (const full of walkFiles(cwd)) {
    const rel = relative(cwd, full);
    if (globRe && !globRe.test(rel)) continue;
    let content: string;
    try {
      if (statSync(full).size > MAX_FILE_BYTES) continue;
      content = readFileSync(full, 'utf8');
    } catch {
      continue; // unreadable / binary
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        if (matches.length >= MAX_RESULTS) return { matches, truncated: true };
        matches.push({ file: rel, line: i + 1, text: lines[i].slice(0, MAX_LINE_LEN) });
      }
    }
  }
  return { matches, truncated: false };
}

/** List worktree files whose relative path matches `pattern` (a glob), capped. */
export function globOp(cwd: string, pattern: string): { files: string[]; truncated: boolean } {
  const re = globToRegExp(pattern);
  const files: string[] = [];
  for (const full of walkFiles(cwd)) {
    const rel = relative(cwd, full);
    if (re.test(rel)) {
      if (files.length >= MAX_RESULTS) return { files, truncated: true };
      files.push(rel);
    }
  }
  return { files, truncated: false };
}
