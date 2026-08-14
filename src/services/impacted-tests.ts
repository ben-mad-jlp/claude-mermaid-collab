/**
 * impacted-tests.ts — static import-graph impacted-set computation for the land-gate
 * regression floor.
 *
 * The full backend floor (~636 files) reds on ~1 random slow timing test per run under
 * load, making every land a coin flip. The floor only needs to answer "did THIS diff
 * break a test?", so we walk the repo's TypeScript sources, build a static import graph,
 * reverse it, and run only the test files that transitively depend on a changed file.
 *
 * The graph is deliberately conservative-by-construction where it can be, and every case
 * it CANNOT see falls back to the full suite via `planImpactedFloor`'s triggers. What the
 * graph does not see: runtime `readFileSync` of config/fixture paths (no import edge) and
 * process-level coupling (env vars, shared SQLite). The infra-path trigger catches the
 * known dangerous ones (scripts/, shared helpers/fixtures, the preloaded tripwire);
 * `ensureTrunkAnchor` (trunk-anchor.ts) — the capped, coalesced FULL-suite gate at the
 * trunk sha, fired after every land and on every anchor miss — is the safety net for the
 * rest: an impacted-set miss self-surfaces there on the next full trunk run.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { QUARANTINE_SEGMENT } from './quarantine';

export interface ImpactedTestsOpts {
  /** Absolute repo root (the epic worktree — imports resolve against ITS tree). */
  repoRoot: string;
  /** Repo-relative changed paths (git diff --name-only --diff-filter=d output). */
  changedFiles: string[];
  /** Repo-relative candidate test files the floor would run. */
  candidateTests: string[];
}

export type ImpactedTestsResult =
  | { ok: true; tests: string[]; unresolvedChanged: string[] }
  | { ok: false; reason: string };

export interface FloorPlan {
  mode: 'impacted' | 'full';
  /** Repo-relative test files to run — impacted mode only. */
  tests?: string[];
  candidateCount: number;
  /** Why the plan fell back to full. null in impacted mode. */
  trigger: string | null;
}

/** Changed paths that invalidate the import graph as a proxy for "what can this diff
 *  break": build/runtime config, the runner itself, and shared test infrastructure that
 *  files consume WITHOUT an import edge (preloads, fixtures read from disk). */
export const FLOOR_INFRA_RES: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)bun\.lock/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /^scripts\//,
  /^\.collab\/project\.json$/,
  /^src\/services\/__tests__\/helpers\//,
  /^src\/services\/__tests__\/fixtures\//,
  /^src\/testing\//,
];

const TEST_FILE_RE = /\.test\.tsx?$/;
const SOURCE_FILE_RE = /\.tsx?$/;

/** Import/require/dynamic-import specifier extraction. Over-matching (specifiers inside
 *  comments or strings) is safe here — it only ADDS edges, which only ADDS tests. */
const SPECIFIER_RES: RegExp[] = [
  /(?:^|[^\w$.])import\s[^'"`()]*?from\s*['"]([^'"]+)['"]/gm, // import x from '...' / import type ... from '...'
  /(?:^|[^\w$.])export\s[^'"`()]*?from\s*['"]([^'"]+)['"]/gm, // export * from '...' (barrels)
  /(?:^|[^\w$.])import\s*['"]([^'"]+)['"]/gm, // side-effect import '...'
  /(?:^|[^\w$.])require\(\s*['"]([^'"]+)['"]\s*\)/gm, // require('...')
  /(?:^|[^\w$.])import\(\s*['"]([^'"]+)['"]\s*\)/gm, // (await) import('...')
];

function extractSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const re of SPECIFIER_RES) {
    re.lastIndex = 0;
    for (const m of source.matchAll(re)) out.push(m[1]);
  }
  return out;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Walk `root` for TypeScript sources, skipping node_modules and dot-dirs (.git, .collab). */
function walkSources(root: string, out: string[] = []): string[] {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walkSources(full, out);
    } else if (SOURCE_FILE_RE.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Resolve a RELATIVE specifier to an on-disk file. Bare package specifiers return null —
 *  dependency changes are covered by the package.json/bun.lock infra trigger instead.
 *  `.js`-suffixed specifiers (NodeNext style) retry as `.ts`/`.tsx`. Non-TS targets that
 *  exist (imported .json fixtures) are kept as graph nodes so a change to them propagates. */
function resolveSpecifier(fromFileAbs: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const base = resolve(dirname(fromFileAbs), spec);
  const candidates: string[] = [base];
  if (/\.[mc]?js$/.test(base)) {
    candidates.push(base.replace(/\.[mc]?js$/, '.ts'), base.replace(/\.[mc]?js$/, '.tsx'));
  }
  candidates.push(`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'));
  for (const c of candidates) {
    if (isFile(c)) return c;
  }
  return null;
}

/**
 * Reverse-reachability over the static import graph: every candidate test that transitively
 * depends on ANY changed file, plus every changed file that is itself a candidate test.
 */
export function computeImpactedTests(opts: ImpactedTestsOpts): ImpactedTestsResult {
  let sources: string[];
  try {
    sources = walkSources(opts.repoRoot);
  } catch (e) {
    return { ok: false, reason: `impacted-tests: source walk failed: ${(e as Error).message}` };
  }

  // reverse edges: target file -> files that import it
  const importers = new Map<string, Set<string>>();
  const nodes = new Set<string>(sources);
  try {
    for (const file of sources) {
      const src = readFileSync(file, 'utf8');
      for (const spec of extractSpecifiers(src)) {
        const target = resolveSpecifier(file, spec);
        if (!target) continue;
        nodes.add(target);
        let set = importers.get(target);
        if (!set) importers.set(target, (set = new Set()));
        set.add(file);
      }
    }
  } catch (e) {
    return { ok: false, reason: `impacted-tests: graph build failed: ${(e as Error).message}` };
  }

  const changedAbs = opts.changedFiles.map((p) => resolve(opts.repoRoot, p));
  // Only .ts/.tsx changes MUST be graph nodes — a changed source file the graph never saw
  // means the graph is not trustworthy for this diff. Non-TS changed files reach tests only
  // via an explicit import edge (e.g. an imported .json); ones nobody imports cannot affect
  // a compiled test and are ignored (the infra trigger owns the dangerous non-TS paths).
  const unresolvedChanged = opts.changedFiles.filter(
    (p, i) => SOURCE_FILE_RE.test(p) && !nodes.has(changedAbs[i]),
  );

  const visited = new Set<string>(changedAbs.filter((p) => nodes.has(p)));
  const queue = [...visited];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const imp of importers.get(cur) ?? []) {
      if (!visited.has(imp)) {
        visited.add(imp);
        queue.push(imp);
      }
    }
  }

  const tests = opts.candidateTests.filter((t) => visited.has(resolve(opts.repoRoot, t))).sort();
  return { ok: true, tests, unresolvedChanged };
}

/** Default floor candidates: the same file set `scripts/test-backend.ts` collects — every
 *  *.test.ts(x) under src/ and desktop/src that imports bun:test, quarantine excluded. */
export function collectFloorCandidates(repoRoot: string): string[] {
  const roots = [join(repoRoot, 'src'), join(repoRoot, 'desktop', 'src')];
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === QUARANTINE_SEGMENT) continue;
        walk(full);
      } else if (TEST_FILE_RE.test(e.name)) {
        try {
          if (/from ['"]bun:test['"]/.test(readFileSync(full, 'utf8'))) out.push(full);
        } catch {
          /* unreadable — skip */
        }
      }
    }
  };
  for (const r of roots) walk(r);
  const prefix = repoRoot.endsWith('/') ? repoRoot : `${repoRoot}/`;
  return out.map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p)).sort();
}

/**
 * Decide impacted vs full for one land-gate floor run. Every trigger errs toward FULL —
 * the impacted path is an optimization, never a correctness relaxation.
 */
export function planImpactedFloor(opts: {
  repoRoot: string;
  changedFiles: string[];
  candidateTests?: string[];
}): FloorPlan {
  let candidates: string[];
  try {
    candidates = opts.candidateTests ?? collectFloorCandidates(opts.repoRoot);
  } catch (e) {
    return { mode: 'full', candidateCount: 0, trigger: `candidate collection failed: ${(e as Error).message}` };
  }
  const full = (trigger: string): FloorPlan => ({ mode: 'full', candidateCount: candidates.length, trigger });

  const infra = opts.changedFiles.find((p) => FLOOR_INFRA_RES.some((re) => re.test(p)));
  if (infra) return full(`infra path changed: ${infra}`);

  const impacted = computeImpactedTests({
    repoRoot: opts.repoRoot,
    changedFiles: opts.changedFiles,
    candidateTests: candidates,
  });
  if (!impacted.ok) return full(impacted.reason);
  if (impacted.unresolvedChanged.length > 0) {
    return full(`changed file(s) not resolvable into the import graph: ${impacted.unresolvedChanged.join(', ')}`);
  }

  const nonTestCodeChange = opts.changedFiles.some((p) => SOURCE_FILE_RE.test(p) && !TEST_FILE_RE.test(p));
  if (impacted.tests.length === 0 && nonTestCodeChange) {
    return full('empty impacted set on a non-test .ts change — graph not trusted');
  }
  if (candidates.length > 0 && impacted.tests.length > 0.6 * candidates.length) {
    return full(`impacted set ${impacted.tests.length}/${candidates.length} exceeds 60% of candidates — no savings`);
  }

  return { mode: 'impacted', tests: impacted.tests, candidateCount: candidates.length, trigger: null };
}
