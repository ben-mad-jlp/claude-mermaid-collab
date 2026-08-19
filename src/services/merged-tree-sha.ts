import { execFileSync } from 'node:child_process';

export function resolveMergedTreeSha(o: {
  repo: string;
  baseSha: string;
  epicTipSha: string;
  git?: (cwd: string, args: string[]) => { code: number; stdout: string };
}): string | null {
  const git = o.git ?? defaultGit;

  let result: { code: number; stdout: string };
  try {
    result = git(o.repo, ['merge-tree', '--write-tree', o.baseSha, o.epicTipSha]);
  } catch {
    return null;
  }

  // Non-zero exit: pre-2.38 git (no --write-tree) or conflicted merge
  if (result.code !== 0) {
    return null;
  }

  // Take the first non-empty line, trimmed
  const lines = result.stdout.trim().split('\n');
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

  // Fail-open: accept only if there is exactly one non-empty line
  if (nonEmptyLines.length !== 1) {
    return null;
  }

  const oid = nonEmptyLines[0].trim();

  // Accept only SHA-1 (40 hex) or SHA-256 (64 hex)
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(oid)) {
    return null;
  }

  return oid;
}

function defaultGit(cwd: string, args: string[]): { code: number; stdout: string } {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    return { code: 0, stdout };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: '' };
  }
}
