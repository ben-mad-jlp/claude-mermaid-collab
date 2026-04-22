import { diffLines } from 'diff';
import type { DiffHunk } from './types';

export function computeHunks(
  original: string,
  proposed: string,
  proposalId: string,
): DiffHunk[] {
  // Normalize trailing newlines to avoid phantom hunks
  const normalizedOriginal = original.replace(/\n+$/, '\n');
  const normalizedProposed = proposed.replace(/\n+$/, '\n');

  const changes = diffLines(normalizedOriginal, normalizedProposed);

  const hasChanges = changes.some((c) => c.added || c.removed);
  if (!hasChanges) return [];

  const hunks: DiffHunk[] = [];
  let baseLineNum = 1;
  let hunkIndex = 0;
  let i = 0;

  while (i < changes.length) {
    const change = changes[i];

    if (!change.added && !change.removed) {
      // Unchanged block — advance base line counter
      baseLineNum += change.count!;
      i++;
      continue;
    }

    // Collect consecutive removed/added changes into one hunk
    const removedLines: string[] = [];
    const addedLines: string[] = [];
    const hunkStartLine = baseLineNum;

    while (i < changes.length && (changes[i].added || changes[i].removed)) {
      const c = changes[i];
      const lines = c.value.split('\n');
      // Remove trailing empty string from split if value ends with \n
      if (lines[lines.length - 1] === '') lines.pop();

      if (c.removed) {
        removedLines.push(...lines);
        baseLineNum += lines.length;
      } else if (c.added) {
        addedLines.push(...lines);
      }
      i++;
    }

    const hunkEndLine = hunkStartLine + addedLines.length - 1;

    hunks.push({
      startLine: hunkStartLine,
      endLine: addedLines.length > 0 ? Math.max(hunkStartLine, hunkEndLine) : hunkStartLine - 1,
      removedLines,
      addedLines,
      proposalId,
      hunkIndex: hunkIndex++,
    });
  }

  return hunks;
}
