/**
 * Canonical-vocabulary lint (Vocab 4 / decision 45a0d906).
 *
 * Flags RETIRED synonyms so the canonical term table (`spec-canonical-vocabulary`)
 * doesn't re-drift. The canonical terms are the allowlist; the retired forms below
 * are the denylist:
 *
 *   worker      ← retires "pool session", "lane"
 *   type        ← retires "pool-type" / "poolType" (as the todo routing key)
 *   workspace   ← retires "collab session"
 *
 * This module is the PURE detector (no git, no fs) so it is deterministically
 * testable. The CI wrapper (`scripts/vocab-lint.ts`) feeds it the CHANGED files
 * only, so not-yet-migrated legacy code is never flagged unless it is touched.
 *
 * Scoping rules:
 *   - CHANGED files only (CI scopes via git) — legacy files left alone stay green.
 *   - LEGACY_ALLOWLIST — files that still carry pre-migration vocab on purpose
 *     (their migration is a separate todo). Remove an entry once that file is
 *     migrated. New/clean files are NOT on this list, so they can never introduce
 *     a retired synonym.
 *   - Inline suppression — `vocab-lint-ignore-line` on the same line, or
 *     `vocab-lint-ignore-next-line` on the line above, or a file-level
 *     `vocab-lint-disable-file` anywhere in the file.
 */

export interface RetiredTerm {
  /** Stable id for the rule. */
  id: string;
  /** Matches the retired synonym. Must be global + have word-ish boundaries. */
  pattern: RegExp;
  /** The canonical term to use instead. */
  canonical: string;
}

/**
 * The denylist. Patterns are case-insensitive and global. `pool[-\s]?type`
 * intentionally also matches the camelCase identifier `poolType`/`PoolType`
 * (zero separator) — that is the retired routing-key synonym per the spec.
 */
export const RETIRED_TERMS: readonly RetiredTerm[] = [
  // worker — the ephemeral process running one todo
  { id: 'pool-session', pattern: /\bpool[-\s]?sessions?\b/gi, canonical: 'worker' },
  { id: 'lane', pattern: /\blanes?\b/gi, canonical: 'worker' },
  // type — the todo routing key (selects the pool)
  { id: 'pool-type', pattern: /\bpool[-\s]?types?\b/gi, canonical: 'type' },
  // workspace — the durable (project, name) namespace
  { id: 'collab-session', pattern: /\bcollab[-\s]?sessions?\b/gi, canonical: 'workspace' },
];

/**
 * Files that still carry pre-migration vocabulary on purpose. Their migration is
 * tracked by sibling Vocab todos (e.g. Vocab 2: Pool/Slot/Worker rename). Remove
 * the entry when the file is migrated. Matched against a repo-root-relative POSIX
 * path (exact match or directory prefix ending in `/`).
 */
export const LEGACY_ALLOWLIST: readonly string[] = [
  // The lint's own source + tests reference the retired terms as data/fixtures.
  'src/services/vocab-lint.ts',
  'src/services/__tests__/vocab-lint.test.ts',
  'scripts/vocab-lint.ts',
  // Pre-migration pool/worker internals (Vocab 2 retires lane/pool-session here).
  'src/services/worker-pool.ts',
  'src/services/coordinator-live.ts',
  'src/services/lane-session-register.ts',
  'src/services/claude-launch.ts',
  'src/services/supervisor-store.ts',
  'src/services/friction-store.ts',
  'src/mcp/tools/friction.ts',
  'src/config.ts',
  'src/services/__tests__/lane-session-register.test.ts',
  'src/services/__tests__/worker-pool.test.ts',
  'src/services/__tests__/coordinator-live.test.ts',
  'src/agent/__tests__/worktree-integration.test.ts',
];

/** Extensions the lint scans. Code + docs; everything else is skipped. */
const LINTABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md', '.mdx',
]);

const INLINE_IGNORE_LINE = 'vocab-lint-ignore-line';
const INLINE_IGNORE_NEXT = 'vocab-lint-ignore-next-line';
const FILE_DISABLE = 'vocab-lint-disable-file';

export interface VocabViolation {
  /** Repo-root-relative path of the offending file (as passed in). */
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the match start. */
  column: number;
  /** The retired text that matched. */
  match: string;
  /** Rule id (RetiredTerm.id). */
  rule: string;
  /** The canonical replacement to suggest. */
  canonical: string;
}

/** Normalize a path to repo-root-relative POSIX form for allowlist matching. */
export function normalizePath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** True if `file` is on the legacy allowlist (exact or under a dir prefix). */
export function isLegacy(file: string): boolean {
  const p = normalizePath(file);
  return LEGACY_ALLOWLIST.some((entry) =>
    entry.endsWith('/') ? p.startsWith(entry) : p === entry,
  );
}

/** True if the lint should scan this path (lintable extension + not legacy). */
export function isLintablePath(file: string): boolean {
  const p = normalizePath(file);
  const dot = p.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = p.slice(dot);
  if (!LINTABLE_EXTENSIONS.has(ext)) return false;
  return !isLegacy(file);
}

/**
 * Scan a single file's content for retired synonyms. Pure — no IO. Honors inline
 * suppression. Returns one violation per match. `file` is used only for labelling
 * and legacy-allowlist checks; pass a repo-relative path.
 */
export function lintContent(content: string, file = '<input>'): VocabViolation[] {
  if (isLegacy(file)) return [];
  if (content.includes(FILE_DISABLE)) return [];

  const violations: VocabViolation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (text.includes(INLINE_IGNORE_LINE)) continue;
    if (i > 0 && lines[i - 1].includes(INLINE_IGNORE_NEXT)) continue;

    for (const term of RETIRED_TERMS) {
      // Fresh lastIndex per line; pattern is global.
      term.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = term.pattern.exec(text)) !== null) {
        violations.push({
          file: normalizePath(file),
          line: i + 1,
          column: m.index + 1,
          match: m[0],
          rule: term.id,
          canonical: term.canonical,
        });
        if (m.index === term.pattern.lastIndex) term.pattern.lastIndex++; // avoid zero-width loop
      }
    }
  }
  return violations;
}

/**
 * Lint a set of files. `read(file)` returns the file's content (caller supplies
 * the IO so this stays testable). Non-lintable / legacy / unreadable paths are
 * skipped. Returns all violations across all files.
 */
export function lintFiles(
  files: readonly string[],
  read: (file: string) => string | null,
): VocabViolation[] {
  const out: VocabViolation[] = [];
  for (const file of files) {
    if (!isLintablePath(file)) continue;
    const content = read(file);
    if (content == null) continue;
    out.push(...lintContent(content, file));
  }
  return out;
}

/** Human-readable one-line rendering of a violation (for CLI output). */
export function formatViolation(v: VocabViolation): string {
  return `${v.file}:${v.line}:${v.column}  retired "${v.match}" → use "${v.canonical}" (rule: ${v.rule})`;
}
