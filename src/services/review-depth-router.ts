import { execFile } from 'node:child_process';

export type ReviewDepth = 'light' | 'standard' | 'heavy';

export interface DiffRisk {
  files: string[];
  addedLines: number;
  deletedLines: number;
}

export const HOT_PATH: readonly string[] = [
  'src/services/leaf-executor.ts',
  'src/services/coordinator-',
  'src/services/mission-store.ts',
  'src/services/conductor-pass.ts',
];

export const REVIEW_HEAVY_LOC = 400;
export const REVIEW_HEAVY_FILES = 12;
export const REVIEW_LIGHT_LOC = 60;

function isDocsOrTestPath(p: string): boolean {
  return p.startsWith('docs/') || p.includes('/docs/') || p.includes('__tests__/') || p.endsWith('.test.ts') || p.endsWith('.test.tsx');
}

export function routeReviewDepth(
  risk: DiffRisk,
  opts?: { lightPathEnabled?: boolean }
): { depth: ReviewDepth; reasons: string[] } {
  const reasons: string[] = [];
  const totalLoc = risk.addedLines + risk.deletedLines;
  const hot = risk.files.filter((f) => HOT_PATH.some((frag) => f.includes(frag)));
  const docsOnly = risk.files.length > 0 && risk.files.every(isDocsOrTestPath);
  const lightEnabled = opts?.lightPathEnabled ?? false;

  let depth: ReviewDepth = 'standard';

  if (hot.length > 0) {
    depth = 'heavy';
    reasons.push('hot-path-found');
  } else if (totalLoc > REVIEW_HEAVY_LOC) {
    depth = 'heavy';
    reasons.push(`total-loc-${totalLoc}-exceeds-${REVIEW_HEAVY_LOC}`);
  } else if (risk.files.length > REVIEW_HEAVY_FILES) {
    depth = 'heavy';
    reasons.push(`files-${risk.files.length}-exceeds-${REVIEW_HEAVY_FILES}`);
  } else if (docsOnly && lightEnabled && totalLoc <= REVIEW_LIGHT_LOC) {
    depth = 'light';
    reasons.push('docs-only-small-diff');
  }

  // HARD FLOOR — explicit named guard, evaluated AFTER classification:
  if (hot.length > 0 && depth === 'light') {
    depth = 'heavy';
    reasons.push('hot-path-floor: hot paths cannot be light');
  }

  return { depth, reasons };
}

/** Async execFile: resolves stdout, or '' on any failure. NEVER a *Sync spawn — this
 *  runs in the sidecar process on the review-spawn path, and a sync git call holds the
 *  event loop for its full runtime (the 45s watchdog crash-loop class, crit-6 693bbc27). */
function gitNumstat(cwd: string, baseRef: string): Promise<string> {
  return new Promise((resolvePromise) => {
    try {
      execFile(
        'git',
        ['-C', cwd, 'diff', '--numstat', baseRef],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => resolvePromise(err ? '' : stdout ?? ''),
      );
    } catch {
      resolvePromise('');
    }
  });
}

export async function collectDiffRisk(cwd: string, baseRef: string): Promise<DiffRisk> {
  try {
    const output = await gitNumstat(cwd, baseRef);

    const files: string[] = [];
    let addedLines = 0;
    let deletedLines = 0;

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;

      const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      const path = parts.slice(2).join('\t');

      files.push(path);
      addedLines += added;
      deletedLines += deleted;
    }

    return { files, addedLines, deletedLines };
  } catch {
    return { files: [], addedLines: 0, deletedLines: 0 };
  }
}
