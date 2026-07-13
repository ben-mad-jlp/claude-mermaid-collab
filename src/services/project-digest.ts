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

import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
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

/** Section: Where things live. Derives top-level dirs from git ls-files. */
function whereThingsLive(project: string): string {
  const lines: string[] = [];
  lines.push('## Where things live');

  // Get files from git, extract top-level dirs.
  const result = runGit(project, ['ls-files']);
  const dirs = new Set<string>();

  if (result.code === 0 && result.stdout) {
    for (const filePath of result.stdout.split('\n')) {
      if (filePath.trim()) {
        const firstSegment = filePath.split('/')[0];
        if (firstSegment) {
          dirs.add(firstSegment);
        }
      }
    }
  }

  // Merge with HOT_DIRS and sort deterministically.
  HOT_DIRS.forEach((d) => dirs.add(d));
  const sortedDirs = Array.from(dirs).sort();

  for (const dir of sortedDirs) {
    lines.push(`- \`${dir}/\` — `);
  }

  return lines.join('\n');
}

/** Section: Key seams & conventions. Placeholder + pointer to CLAUDE.md. */
function keySeams(_project: string): string {
  const lines: string[] = [];
  lines.push('## Key seams & conventions');
  lines.push('- see `CLAUDE.md` for conventions');
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
  const sections = [
    whereThingsLive(project),
    keySeams(project),
    artifacts(project),
    deeperDocs(project),
  ];

  const body = sections.join('\n\n');
  return assembleDigest(body);
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
