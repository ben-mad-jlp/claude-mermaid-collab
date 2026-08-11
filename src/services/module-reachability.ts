/**
 * Module reachability scanner: identifies modules added in a land commit that have
 * no non-test importers, preventing them from serving a graded criterion.
 *
 * No spawnSync/execSync — uses async execFile via node:child_process.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, extname } from 'node:path';
import { trackingProjectRoot } from './project-registry.js';
import { listTodos, type Todo } from './todo-store.js';
import { getEpicLandRecord } from './epic-land-record-store.js';
import { isEpicTodo } from './invariant-check.js';
import { todoServesCriterion } from './criterion-edges.js';

const execFileAsync = promisify(execFile);

/** Async git runner, mirroring the shape from tree-integrity.ts:14 */
async function git(
  cwd: string,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  try {
    const result = await execFileAsync('git', args, { cwd, timeout: 10_000 });
    return { code: 0, out: (result.stdout ?? '').trim(), err: '' };
  } catch (e: any) {
    // execFile throws on non-zero exit
    return {
      code: e.code ?? 1,
      out: (e.stdout ?? '').trim(),
      err: (e.stderr ?? '').trim(),
    };
  }
}

/** Helper: check if a file path is a test or metadata file.
 *  Mirrors isTestPath (verdict-test-only.ts:25) and isTestFilePath (leaf-executor.ts:319).
 */
function isTestOrMetaPath(path: string): boolean {
  if (/(^|\/)__tests__\//.test(path)) return true;
  if (/(^|\/)__fixtures__\//.test(path)) return true;
  const basename = path.split('/').pop() ?? path;
  if (/\.(test|spec)\.tsx?$/.test(basename)) return true;
  if (/\.d\.ts$/.test(basename)) return true;
  return false;
}

/** Check if a file path is a scannable source file: src/ or ui/src/, .ts/.tsx, not test/meta. */
export function isScannableSourcePath(path: string): boolean {
  if (!/^(src|ui\/src)\//.test(path)) return false;
  if (!/\.tsx?$/.test(path)) return false;
  if (isTestOrMetaPath(path)) return false;
  return true;
}

/** Get the list of source files added in a commit (merge or regular).
 *  Returns paths relative to repoRoot, matching src/ or ui/src/ with .ts/.tsx extension,
 *  excluding test and metadata files.
 */
export async function addedSourceFilesForLand(
  project: string,
  landSha: string,
  deps?: any,
): Promise<string[]> {
  const repoRoot = trackingProjectRoot(project);

  // Use ^1 to get the first parent of a merge commit, allowing this to work with merge shas
  const { code, out, err } = await git(repoRoot, [
    'diff',
    '--name-only',
    '--diff-filter=A',
    `${landSha}^1`,
    landSha,
  ]);

  if (code !== 0 && out === '') {
    // Git probe failed and stdout is empty — return indeterminate marker
    return [];
  }

  if (!out) {
    return [];
  }

  const lines = out.split('\n').filter(line => line.trim().length > 0);

  const files = lines.filter(isScannableSourcePath);

  return files;
}

/** Walk source directories to find non-test files that import a given file.
 *  Returns true if at least one non-test importer is found, false otherwise.
 */
export async function hasNonTestImporter(
  repoRoot: string,
  relPath: string,
  deps?: any,
): Promise<boolean> {
  // Walk src/ and ui/src/, skipping __tests__ and test files
  const srcDir = join(repoRoot, 'src');
  const uiSrcDir = join(repoRoot, 'ui', 'src');

  async function walk(dir: string): Promise<boolean> {
    if (!existsSync(dir)) {
      return false;
    }

    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip __tests__ directories
      if (entry.name === '__tests__') {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relFullPath = relative(repoRoot, fullPath).split('\\').join('/');

      if (entry.isDirectory()) {
        const found = await walk(fullPath);
        if (found) return true;
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      ) {
        // Skip test/meta files
        if (isTestOrMetaPath(relFullPath)) {
          continue;
        }

        // Read file and check for imports
        const content = await readFile(fullPath, 'utf8');

        // Check if this file imports relPath (directly or via extension resolution)
        if (importsFile(content, fullPath, relPath, repoRoot)) {
          return true;
        }
      }
    }

    return false;
  }

  // Walk both directories
  if (await walk(srcDir)) return true;
  if (await walk(uiSrcDir)) return true;

  return false;
}

/** Check if content (a source file) imports relPath via any import mechanism.
 *  Handles relative imports, extension resolution, and ESM/CJS patterns.
 */
function importsFile(
  content: string,
  importingFile: string,
  relPath: string,
  repoRoot: string,
): boolean {
  const repoRoot_ = repoRoot.endsWith('/') ? repoRoot : `${repoRoot}/`;
  const relDir = dirname(importingFile).slice(repoRoot_.length);
  const importingDir = resolve(repoRoot, relDir);

  // Regex for static imports: import ... from '...', import type from '...', export * from '...', bare import '...'
  const staticImportRe =
    /(?:import\s+(?:type\s+)?[^;]*\s+from\s+|export\s+\*\s+from\s+|^import\s+)['"]([^'"]+)['"]/gm;

  let match: RegExpExecArray | null;
  while ((match = staticImportRe.exec(content)) !== null) {
    const spec = match[1];
    if (resolveImportSpec(spec, importingDir, relPath, repoRoot)) {
      return true;
    }
  }

  // Regex for dynamic imports: import('...')
  const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
  while ((match = dynamicImportRe.exec(content)) !== null) {
    const spec = match[1];
    if (resolveImportSpec(spec, importingDir, relPath, repoRoot)) {
      return true;
    }
  }

  return false;
}

/** Resolve an import specifier to see if it matches relPath.
 *  Handles relative specifiers, extension resolution, .js → .ts mapping.
 */
function resolveImportSpec(
  spec: string,
  importingDir: string,
  relPath: string,
  repoRoot: string,
): boolean {
  // Only relative specifiers (starting with .) can resolve to relPath
  if (!spec.startsWith('.')) {
    return false;
  }

  // Resolve the import path
  let resolved = resolve(importingDir, spec);
  const resolvedRel = relative(repoRoot, resolved).split('\\').join('/');

  // Try exact match first
  if (resolvedRel === relPath) {
    return true;
  }

  // Try adding extensions: .ts, .tsx, /index.ts, /index.tsx
  const candidates = [
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${join(resolved, 'index.ts')}`,
    `${join(resolved, 'index.tsx')}`,
  ];

  for (const candidate of candidates) {
    const candidateRel = relative(repoRoot, candidate).split('\\').join('/');
    if (candidateRel === relPath) {
      return true;
    }
  }

  // If spec ends .js, strip it and try .ts/.tsx
  if (spec.endsWith('.js')) {
    const stripped = spec.slice(0, -3);
    let resolvedStripped = resolve(importingDir, stripped);
    const resolvedStrippedRel = relative(repoRoot, resolvedStripped)
      .split('\\')
      .join('/');

    if (resolvedStrippedRel === relPath) {
      return true;
    }

    const strippedCandidates = [
      `${resolvedStripped}.ts`,
      `${resolvedStripped}.tsx`,
      `${join(resolvedStripped, 'index.ts')}`,
      `${join(resolvedStripped, 'index.tsx')}`,
    ];

    for (const candidate of strippedCandidates) {
      const candidateRel = relative(repoRoot, candidate).split('\\').join('/');
      if (candidateRel === relPath) {
        return true;
      }
    }
  }

  return false;
}

/** Shared git-diff helper for multiple shas */
async function getAddedFilesForShas(
  repoRoot: string,
  landShas: string[],
): Promise<{ scanned: string[]; probeFailed: boolean }> {
  const scanned = new Set<string>();
  let probeFailed = false;

  for (const sha of landShas) {
    const { code, out } = await git(repoRoot, [
      'diff',
      '--name-only',
      '--diff-filter=A',
      `${sha}^1`,
      sha,
    ]);

    if (code !== 0 && out === '') {
      probeFailed = true;
      continue;
    }

    if (out) {
      const lines = out.split('\n').filter(line => line.trim().length > 0);
      for (const line of lines) {
        if (isScannableSourcePath(line)) {
          scanned.add(line);
        }
      }
    }
  }

  return { scanned: Array.from(scanned), probeFailed };
}

/** Check if a path is exempt from reachability requirements.
 *  Exemptions: bin/, scripts/, or values from package.json's main/module/bin fields.
 */
function isExemptEntrypoint(repoRoot: string, relPath: string): boolean {
  // Check for bin/ or scripts/ segment
  if (/^(bin|scripts)\//.test(relPath) || /\/(bin|scripts)\//.test(relPath)) {
    return true;
  }

  // Check against package.json fields
  try {
    const pkgPath = join(repoRoot, 'package.json');
    if (!existsSync(pkgPath)) {
      return false;
    }

    const pkgContent = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgContent);

    const exemptPaths = [pkg.main, pkg.module, pkg.bin].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );

    // Normalize paths to POSIX format
    const relPathNorm = relPath.split('\\').join('/');
    for (const exemptPath of exemptPaths) {
      const exemptNorm = exemptPath
        .split('\\')
        .join('/')
        .replace(/^\.\//, '');
      if (relPathNorm === exemptNorm) {
        return true;
      }
    }
  } catch {
    // Ignore parse errors — missing/garbage package.json means no exemptions
  }

  return false;
}

/** Classify which modules added in serving epics are unreachable (no non-test importers). */
export async function classifyServingEpicReachability(input: {
  repoRoot: string;
  landShas: string[];
  deps?: any;
}): Promise<{ unreachable: string[]; scanned: string[]; indeterminate: boolean }> {
  const { repoRoot, landShas, deps } = input;

  if (landShas.length === 0) {
    return { unreachable: [], scanned: [], indeterminate: true };
  }

  // Get all added files across all shas
  const { scanned, probeFailed } = await getAddedFilesForShas(repoRoot, landShas);

  if (scanned.length === 0 && probeFailed) {
    return { unreachable: [], scanned: [], indeterminate: true };
  }

  // Check each non-exempt file for importers
  const unreachable: string[] = [];

  for (const path of scanned) {
    // Skip exempt entrypoints
    if (isExemptEntrypoint(repoRoot, path)) {
      continue;
    }

    // Check if the file has a non-test importer
    const hasImporter = await hasNonTestImporter(repoRoot, path, deps);
    if (!hasImporter) {
      unreachable.push(path);
    }
  }

  return { unreachable, scanned, indeterminate: false };
}

/** Guard for grading-path: throws if a serving epic landed unreachable modules with no non-test importers. */
export async function assertServingEpicModulesReachable(
  project: string,
  criterionId: string,
  deps?: any,
): Promise<void> {
  const repoRoot = trackingProjectRoot(project);

  try {
    // Find epics serving this criterion
    const todos = listTodos(project);
    const servingEpics = todos.filter(
      t => isEpicTodo(t) && todoServesCriterion(t, criterionId),
    );

    if (servingEpics.length === 0) {
      // No serving epics — fail open
      return;
    }

    // Collect deduped land record shas
    const landShas = new Set<string>();

    for (const epic of servingEpics) {
      try {
        const landRecord = getEpicLandRecord(project, epic.id);
        if (landRecord?.landedMergeSha) {
          landShas.add(landRecord.landedMergeSha);
        }
      } catch {
        // Skip epics whose land record lookup fails
      }
    }

    if (landShas.size === 0) {
      // No resolvable land shas — fail open
      return;
    }

    // Classify reachability
    const result = await classifyServingEpicReachability({
      repoRoot,
      landShas: Array.from(landShas),
      deps,
    });

    if (result.indeterminate || result.unreachable.length === 0) {
      return;
    }

    // Throw if unreachable modules found
    throw new Error(
      `criterion cannot grade met: landed-but-unreachable module(s) with no non-test importer: ${result.unreachable.join(', ')}`,
    );
  } catch (e) {
    // If the error is our reachability check, re-throw it
    if (e instanceof Error && e.message.includes('criterion cannot grade met')) {
      throw e;
    }

    // Any other error is indeterminate — fail open
    return;
  }
}
