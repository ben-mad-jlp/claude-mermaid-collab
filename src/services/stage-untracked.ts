// MITIGATION for the leaf-executor implement→review new-file blind spot.
//
// The review node inspects the change-set with git. A file the implement node CREATED is
// untracked: `git status` shows it as `??`, but `git diff HEAD` OMITS it entirely. A review node
// reaching for a diff of the working tree therefore goes blind, truthfully reports the file
// "absent", and the leaf thrashes implement→review to node-budget exhaustion.
//
// `git add --intent-to-add` records a zero-content path in the index. After the sweep,
// `git diff`, `git diff HEAD` and `git diff <base>` (two-dot) all show the file's content, and
// `git status` reports it as ` A`. `git diff <base>...HEAD` (THREE-dot) does NOT and cannot:
// three-dot diffs two COMMITS, so it never sees uncommitted work, intent-to-add or otherwise.
// The content stays out of the index — `git diff --cached` prints nothing for the entry.
//
// LOAD-BEARING: the enumerator is `git ls-files --others --exclude-standard`, NEVER
// `git status --porcelain`. Porcelain COLLAPSES a wholly-untracked directory to the directory
// path (`?? src/`) and never names the file inside it; `ls-files --others` enumerates the FILES
// whether or not the parent directory is already tracked. With porcelain we would run
// `git add --intent-to-add -- src/` on a brand-new directory, and the sweep would report the
// directory rather than the files it staged. Do not "simplify" this to a status parse.
//
// We deliberately never use `git add -A`/`-u`/`.`: those would also stage .gitignore'd junk
// (db snapshots, deploy logs) that worktrees accumulate.

import { execFileSync } from 'node:child_process';

const CHUNK_SIZE = 500;

/** List untracked, NON-IGNORED paths in `cwd`. `--exclude-standard` applies .gitignore,
 *  .git/info/exclude and the global excludes — we never roll our own filter. Files, not
 *  directories: unlike `git status --porcelain`, this does not collapse a new directory. */
export function listUntrackedPaths(cwd: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['-C', cwd, 'ls-files', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return out.split('\0').filter((p) => p.length > 0);
  } catch {
    return [];
  }
}

/** Record each untracked, non-ignored path in the index WITHOUT staging its content, so the
 *  review node's git views can see newly created files. Best-effort: never throws.
 *  Returns the paths staged (empty on failure or when there is nothing to stage). */
export function stageUntrackedIntentToAdd(cwd: string): string[] {
  const paths = listUntrackedPaths(cwd);
  if (paths.length === 0) return [];

  const staged: string[] = [];
  for (let i = 0; i < paths.length; i += CHUNK_SIZE) {
    const chunk = paths.slice(i, i + CHUNK_SIZE);
    try {
      execFileSync('git', ['-C', cwd, 'add', '--intent-to-add', '--', ...chunk], { stdio: 'ignore' });
      staged.push(...chunk);
    } catch {
      // give up on this chunk; never break the run
    }
  }
  return staged;
}
