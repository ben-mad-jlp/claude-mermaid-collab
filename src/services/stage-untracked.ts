// MITIGATION for the leaf-executor implement→review new-file blind spot.
//
// The review node inspects the change-set with git. A file the implement node CREATED is
// untracked, and `git diff` never shows untracked files — the review node then truthfully
// reports it "absent" and the leaf thrashes implement→review to node-budget exhaustion.
// `git add --intent-to-add` records a zero-content path in the index, which every
// working-tree/index-aware git view (`git diff`, `git diff <base>`, `git status`) picks up,
// without staging the file's content. We deliberately never use `git add -A`/`-u`/`.`: those
// would also stage .gitignore'd junk (db snapshots, deploy logs) that worktrees accumulate.

import { execFileSync } from 'node:child_process';

const CHUNK_SIZE = 500;

/** List untracked, NON-IGNORED paths in `cwd`. `--exclude-standard` applies .gitignore,
 *  .git/info/exclude and the global excludes — we never roll our own filter. */
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
