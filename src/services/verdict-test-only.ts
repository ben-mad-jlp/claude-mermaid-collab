// Pure verdict classifier: test-only vs product-touching, plus TO CLOSE extraction.
// No imports from any DB/store module, no fs, no clock — callable with only its input.

const PATH_WITH_LINE_RE =
  /(?:^|[\s(`'"[,])((?:\.\/)?(?:[\w.@-]+\/)*(?:[\w.@-]*\.[A-Za-z0-9]+|\.[A-Za-z][\w.-]*)):(\d+)(?:-\d+)?/g;

const BARE_PATH_RE =
  /(?:^|[\s(`'"[,])((?:\.\/)?(?:[\w.@-]+\/)+(?:[\w.@-]*\.[A-Za-z0-9]+|\.[A-Za-z][\w.-]*))(?=$|[\s)`'",.;:!?\]])/g;

export function parseCitedPaths(evidence: string | null): string[] {
  if (!evidence) return [];
  const found: string[] = [];
  PATH_WITH_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_WITH_LINE_RE.exec(evidence)) !== null) {
    found.push(m[1]);
  }
  BARE_PATH_RE.lastIndex = 0;
  while ((m = BARE_PATH_RE.exec(evidence)) !== null) {
    found.push(m[1]);
  }
  return Array.from(new Set(found));
}

function isTestPath(path: string): boolean {
  if (/(^|\/)__tests__\//.test(path)) return true;
  const basename = path.split('/').pop() ?? path;
  return /\.(test|spec)\.tsx?$/.test(basename);
}

export function classifyVerdictTestOnly(input: {
  evidence: string | null;
  evidencePaths: string[] | null | undefined;
}): { testOnly: boolean; testPaths: string[]; nonTestPaths: string[]; reason: string } {
  const fromArray = (input.evidencePaths ?? []).filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  const fromEvidence = parseCitedPaths(input.evidence);
  const union = Array.from(new Set([...fromArray, ...fromEvidence]));

  if (union.length === 0) {
    return { testOnly: false, testPaths: [], nonTestPaths: [], reason: 'no-cited-paths' };
  }

  const testPaths = union.filter(isTestPath);
  const nonTestPaths = union.filter((p) => !isTestPath(p));

  if (nonTestPaths.length === 0) {
    return { testOnly: true, testPaths, nonTestPaths: [], reason: 'all-cited-paths-are-tests' };
  }

  return { testOnly: false, testPaths, nonTestPaths, reason: 'product-path-cited' };
}

export function extractToCloseText(evidence: string | null): string | null {
  if (!evidence) return null;
  const trimmed = evidence.trim();
  if (!trimmed) return null;
  const match = /TO CLOSE/i.exec(trimmed);
  if (!match) return trimmed;
  return trimmed.slice(match.index).trim();
}
