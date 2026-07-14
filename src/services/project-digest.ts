/**
 * Deterministic project-digest generator — orientation hints for a project.
 *
 * Assembles a pure, deterministic markdown digest from git and filesystem facts,
 * respecting a strict token budget (≤5000), with truncation + marker when over-budget.
 * No LLM, no daemon, no gate wiring; a later leaf injects the digest into prompts.
 *
 * Exports: DIGEST_HEADER, estimateTokens, assembleDigest, generateProjectDigest,
 * writeProjectDigest, ProjectDigest interface.
 */

import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

export const DIGEST_HEADER =
  'orientation hints — VERIFY against the tree; paths may be stale';

const TOKEN_BUDGET = 5000;
const TRUNCATION_MARKER = '\n\n[digest truncated]';
const HOT_DIRS = ['src/services', 'src/mcp', 'ui/src', 'skills', 'bin'];

export interface ProjectDigest {
  markdown: string;
  tokens: number;
}

/** LLM-produced synthesis: one-line purpose per dir + seam bullet lines. */
export interface DigestSynthesis {
  dirPurposes: Record<string, string>;
  seams: string[];
}

/** Injected LLM node. Single bounded call. Mocked in tests. */
export type DigestLlm = (input: {
  claudeMd: string;
  dirs: string[];
  sample: string;
}) => DigestSynthesis | Promise<DigestSynthesis>;

/** Sidecar metadata including skeleton hash and persisted synthesis. */
interface DigestMeta {
  tokens: number;
  generatedAt: string;
  generatedAtSha: string;
  skeletonHash: string;
  synthesis?: DigestSynthesis;
}

const MAX_PURPOSE_CHARS = 100;
const MAX_SEAMS = 8;
const MAX_SEAM_CHARS = 160;

/** Token estimator: ceil(chars / 4). */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** Run git in `cwd`, returning { code, stdout }. Never throws; never hangs (timeout). */
function runGit(
  cwd: string,
  args: string[],
): { code: number; stdout: string } {
  try {
    const p = Bun.spawnSync(['git', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: 15_000,
    });
    return { code: p.exitCode ?? 1, stdout: p.stdout?.toString() ?? '' };
  } catch {
    return { code: 1, stdout: '' };
  }
}

/** Sorted, deduped top-level dirs from `git ls-files` merged with HOT_DIRS. */
export function topLevelDirs(project: string): string[] {
  const result = runGit(project, ['ls-files']);
  const dirs = new Set<string>();
  if (result.code === 0 && result.stdout) {
    for (const filePath of result.stdout.split('\n')) {
      const trimmed = filePath.trim();
      const slash = trimmed.indexOf('/');
      if (slash > 0) dirs.add(trimmed.slice(0, slash));
    }
  }
  HOT_DIRS.forEach((d) => dirs.add(d));
  return Array.from(dirs).sort();
}

/** Read CLAUDE.md content ('' if absent). */
function readClaudeMd(project: string): string {
  try {
    return readFileSync(join(project, 'CLAUDE.md'), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Path-inclusive skeleton hash: sha256 over the sorted dir path list AND
 * the CLAUDE.md content. A renamed/added dir OR a CLAUDE.md edit changes it.
 */
export function computeSkeletonHash(project: string): string {
  const dirs = topLevelDirs(project);
  const claudeMd = readClaudeMd(project);
  return createHash('sha256')
    .update(JSON.stringify(dirs))
    .update(' ')
    .update(claudeMd)
    .digest('hex');
}

/** Clamp synthesis so the assembled digest stays under budget. */
export function boundSynthesis(s: DigestSynthesis): DigestSynthesis {
  const dirPurposes: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.dirPurposes ?? {})) {
    dirPurposes[k] = String(v).replace(/\s+/g, ' ').slice(0, MAX_PURPOSE_CHARS);
  }
  const seams = (s.seams ?? [])
    .slice(0, MAX_SEAMS)
    .map((l) => String(l).replace(/\s+/g, ' ').slice(0, MAX_SEAM_CHARS));
  return { dirPurposes, seams };
}

/** Read the sidecar metadata file, returning null if absent or invalid. */
function readMeta(project: string): DigestMeta | null {
  try {
    const raw = readFileSync(
      join(project, '.collab', 'project-digest.meta.json'),
      'utf-8',
    );
    return JSON.parse(raw) as DigestMeta;
  } catch {
    return null;
  }
}

/** Section: Where things live. Derives top-level dirs from git ls-files. */
function whereThingsLive(
  project: string,
  synthesis?: DigestSynthesis,
): string {
  const lines: string[] = [];
  lines.push('## Where things live');

  const dirs = topLevelDirs(project);

  for (const dir of dirs) {
    const purpose = synthesis?.dirPurposes[dir] ?? '';
    lines.push(`- \`${dir}/\` — ${purpose}`);
  }

  return lines.join('\n');
}

/** Section: Key seams & conventions. Placeholder + pointer to CLAUDE.md. */
function keySeams(
  _project: string,
  synthesis?: DigestSynthesis,
): string {
  const lines: string[] = [];
  lines.push('## Key seams & conventions');
  if (synthesis?.seams?.length) {
    for (const seam of synthesis.seams) {
      lines.push(`- ${seam}`);
    }
  } else {
    lines.push('- see `CLAUDE.md` for conventions');
  }
  return lines.join('\n');
}

/** Section: Artifacts. Static path-pattern pointers. */
function artifacts(_project: string): string {
  const lines: string[] = [];
  lines.push('## Artifacts');
  lines.push('- `.collab/sessions/*/documents/` — design docs');
  lines.push('- `.collab/leaf-blueprints/` — leaf blueprints');
  lines.push('- `.collab/agent-sessions/` — transcript archives');
  return lines.join('\n');
}

/** Section: Deeper docs. Filenames from glob of design-doc dir. */
function deeperDocs(project: string): string {
  const lines: string[] = [];
  lines.push('## Deeper docs');

  const docDir = join(project, '.collab', 'sessions');
  const docNames = new Set<string>();

  try {
    const sessions = readdirSync(docDir, { withFileTypes: true });
    for (const s of sessions) {
      if (s.isDirectory()) {
        const documentsDir = join(docDir, s.name, 'documents');
        try {
          const files = readdirSync(documentsDir, { withFileTypes: true });
          for (const f of files) {
            if (f.isFile() && f.name.endsWith('.md')) {
              docNames.add(f.name);
            }
          }
        } catch {
          // Directory missing or unreadable; skip.
        }
      }
    }
  } catch {
    // docDir missing or unreadable; emit header + nothing.
  }

  if (docNames.size === 0) {
    lines.push('(none)');
  } else {
    const sorted = Array.from(docNames).sort();
    for (const name of sorted) {
      lines.push(`- ${name}`);
    }
  }

  return lines.join('\n');
}

/**
 * Pure assembly: given a body string, assemble the digest with header,
 * enforce budget by truncation if needed, and return { markdown, tokens }.
 * The header is ALWAYS preserved.
 */
export function assembleDigest(body: string): ProjectDigest {
  const header = DIGEST_HEADER + '\n';
  let markdown = header + '\n' + body;

  const tokens = estimateTokens(markdown);
  if (tokens > TOKEN_BUDGET) {
    // Over budget: slice to fit, then append marker.
    // Simpler robust form: the available chars are the budget minus the marker length.
    const charBudget = TOKEN_BUDGET * 4;
    const markerLength = TRUNCATION_MARKER.length;
    const availableChars = charBudget - markerLength;

    // Slice the full markdown (header + separator + body) to fit, then append marker.
    markdown = markdown.slice(0, availableChars) + TRUNCATION_MARKER;

    // Verify header is still there (should always be true given the generous budget).
    if (!markdown.startsWith(DIGEST_HEADER)) {
      markdown = header + TRUNCATION_MARKER;
    }
  }

  return {
    markdown,
    tokens: estimateTokens(markdown),
  };
}

/**
 * Generate project digest from git + filesystem facts (no I/O write).
 * Returns { markdown, tokens } with markdown ≤ 5000 tokens.
 */
export function generateProjectDigest(project: string): ProjectDigest {
  return generateProjectDigestWith(project, undefined);
}

/**
 * Generate project digest with optional synthesis (dirPurposes + seams).
 * Returns { markdown, tokens } with markdown ≤ 5000 tokens.
 */
export function generateProjectDigestWith(
  project: string,
  synthesis?: DigestSynthesis,
): ProjectDigest {
  const body = [
    whereThingsLive(project, synthesis),
    keySeams(project, synthesis),
    artifacts(project),
    deeperDocs(project),
  ].join('\n\n');
  return assembleDigest(body);
}

/**
 * Regenerate the digest. Deterministic sections always rebuilt. The LLM node
 * (opts.llm) is invoked EXACTLY ONCE only when the skeleton hash changed (or no
 * prior meta); on an unchanged hash the persisted synthesis is reused and the LLM
 * is NOT called.
 */
export async function regenerateProjectDigest(
  project: string,
  opts?: { llm?: DigestLlm },
): Promise<ProjectDigest> {
  const currentHash = computeSkeletonHash(project);
  const prior = readMeta(project);

  let synthesis: DigestSynthesis | undefined;
  if (prior && prior.skeletonHash === currentHash && prior.synthesis) {
    synthesis = prior.synthesis; // SKIP: reuse, no LLM call
  } else if (opts?.llm) {
    synthesis = boundSynthesis(
      await opts.llm({
        claudeMd: readClaudeMd(project),
        dirs: topLevelDirs(project),
        sample: '', // bounded sample (empty for now)
      }),
    ); // EXACTLY ONE bounded call
  }

  const digest = generateProjectDigestWith(project, synthesis);

  const dir = join(project, '.collab');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project-digest.md'), digest.markdown);
  const meta: DigestMeta = {
    tokens: digest.tokens,
    generatedAt: new Date().toISOString(),
    generatedAtSha: runGit(project, ['rev-parse', 'HEAD']).stdout.trim(),
    skeletonHash: currentHash,
    synthesis,
  };
  writeFileSync(
    join(dir, 'project-digest.meta.json'),
    JSON.stringify(meta, null, 2),
  );
  return digest;
}

/**
 * Write project digest to .collab/project-digest.md + sidecar .meta.json.
 * Returns { markdown, tokens }.
 */
export function writeProjectDigest(project: string): ProjectDigest {
  const digest = generateProjectDigest(project);

  const dir = join(project, '.collab');
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'project-digest.md'), digest.markdown);

  // Sidecar metadata.
  const generatedAtSha = runGit(project, ['rev-parse', 'HEAD']).stdout.trim();
  const skeletonHash = createHash('sha256')
    .update(digest.markdown)
    .digest('hex');

  const meta = {
    tokens: digest.tokens,
    generatedAt: new Date().toISOString(),
    generatedAtSha,
    skeletonHash,
  };

  writeFileSync(join(dir, 'project-digest.meta.json'), JSON.stringify(meta, null, 2));

  return digest;
}

/**
 * Read the cached project digest (.collab/project-digest.md). Returns the file
 * contents, or null if absent/unreadable. Never regenerates — read-only.
 */
export function readProjectDigest(project: string): string | null {
  try {
    return readFileSync(join(project, '.collab', 'project-digest.md'), 'utf-8');
  } catch {
    return null;
  }
}
