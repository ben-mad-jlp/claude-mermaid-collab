/**
 * blueprint-lab corpus — mined from this repo's own git history.
 *
 * Unlike reviewer-lab/cases.ts (hand-authored synthetic accept/reject cases), this corpus is
 * built from real landed leaves: real commits this repo actually shipped, paired with the real
 * base..HEAD diff each one produced. It exists so a future blueprint/contract-quality harness can
 * check a proposed DiffContract (src/services/diff-contract.ts) against what a leaf *actually*
 * touched, instead of against a synthetic fixture.
 *
 * This module only builds and exports CORPUS — it does not wire into any harness or gate.
 */
import { execFileSync } from 'node:child_process';
import type { DiffLeafKind } from '../../src/services/diff-contract.ts';

/** One historical landed leaf, mined from this repo's own git history: the leaf spec a
 *  blueprint node would have authored, paired with the real base..HEAD diff it produced. */
export interface CorpusCase {
  id: string; // commit short SHA (7 hex)
  commitSha: string; // full SHA
  leafKind: DiffLeafKind;
  spec: {
    title: string; // commit subject, prefix stripped
    description: string; // commit body (may be '')
    files: string[]; // files the commit subject/body implies — same as touchedFiles
    // here since we mine after the fact, not before
  };
  diff: {
    baseSha: string; // parent commit SHA
    touchedFiles: string[]; // git diff --name-status, path column
    changedSymbols: string[]; // symbol names introduced/changed, see below
  };
}

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

const RECORD_SEP = '\x1e';
const UNIT_SEP = '\x1f';

const MIN_CASES = 10;
const MIN_LEAF_KINDS = 3;
const MAX_SYMBOLS_PER_CASE = 40;

const INFRA_PATH_RE = /^(scripts\/|\.github\/|bin\/|\.claude-plugin\/|docker|Dockerfile|package\.json$|tsconfig)/i;

interface RawCommit {
  sha: string;
  shortSha: string;
  parents: string[];
  subject: string;
  body: string;
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function parseLog(): RawCommit[] {
  const out = git(['log', `--pretty=%H${UNIT_SEP}%h${UNIT_SEP}%P${UNIT_SEP}%s${UNIT_SEP}%b${RECORD_SEP}`, '-500']);
  const records = out.split(RECORD_SEP).map((r) => r.replace(/^\n/, '')).filter((r) => r.trim().length > 0);
  const commits: RawCommit[] = [];
  for (const record of records) {
    const fields = record.split(UNIT_SEP);
    if (fields.length < 5) continue;
    const [sha, shortSha, parentsRaw, subject, bodyRaw] = fields;
    const parents = parentsRaw.trim().length > 0 ? parentsRaw.trim().split(/\s+/) : [];
    commits.push({ sha, shortSha, parents, subject: subject.trim(), body: bodyRaw.trim() });
  }
  return commits;
}

export function classifyLeafKind(subject: string, touchedFiles: string[]): DiffLeafKind {
  if (/^feat(\(|:)/i.test(subject)) return 'feature';
  if (/^fix(\(|:)/i.test(subject)) return 'fix';
  if (/^test(\(|:)/i.test(subject)) return 'test';
  if (/refactor/i.test(subject)) return 'refactor';
  if (touchedFiles.length > 0 && touchedFiles.every((f) => INFRA_PATH_RE.test(f))) return 'infra';
  return 'feature';
}

function getTouchedFiles(parentSha: string, sha: string): string[] {
  const out = git(['diff', '--name-status', parentSha, sha]);
  const files: string[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts[0].startsWith('R')) {
      // rename: status, old, new — take new
      files.push(parts[2] ?? parts[1]);
    } else {
      files.push(parts[1]);
    }
  }
  return files.filter(Boolean);
}

const SYMBOL_PATTERNS: RegExp[] = [
  /^\+\s*export\s+(?:async\s+)?function\s+(\w+)/,
  /^\+\s*export\s+(?:default\s+)?class\s+(\w+)/,
  /^\+\s*export\s+(?:const|let|var)\s+(\w+)/,
  /^\+\s*export\s+(?:type|interface)\s+(\w+)/,
  /^\+\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
  /^\+\s*def\s+(\w+)/,
];

export function extractChangedSymbols(sha: string, parentSha: string, touchedFiles: string[]): string[] {
  if (touchedFiles.length === 0) return [];
  try {
    const out = git(['diff', '-U0', parentSha, sha, '--', ...touchedFiles]);
    const symbols = new Set<string>();
    for (const line of out.split('\n')) {
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      for (const pattern of SYMBOL_PATTERNS) {
        const match = pattern.exec(line);
        if (match?.[1]) {
          symbols.add(match[1]);
          break;
        }
      }
    }
    return [...symbols].slice(0, MAX_SYMBOLS_PER_CASE);
  } catch {
    return [];
  }
}

function stripSubjectPrefix(subject: string): string {
  return subject.replace(/^[a-zA-Z]+(\([a-zA-Z_-]+\))?:\s*/, '').trim();
}

function buildCorpus(): CorpusCase[] {
  const commits = parseLog();
  const cases: CorpusCase[] = [];
  const seenKinds = new Set<DiffLeafKind>();
  let previousKeptSubject: string | null = null;

  for (const commit of commits) {
    if (commit.parents.length !== 1) continue;
    if (commit.subject.startsWith('collab:') || commit.subject.startsWith('Merge:')) continue;
    if (previousKeptSubject !== null && commit.subject === previousKeptSubject) continue;

    previousKeptSubject = commit.subject;

    const parentSha = commit.parents[0];
    const touchedFiles = getTouchedFiles(parentSha, commit.sha);
    const leafKind = classifyLeafKind(commit.subject, touchedFiles);
    const changedSymbols = extractChangedSymbols(commit.sha, parentSha, touchedFiles);

    cases.push({
      id: commit.shortSha,
      commitSha: commit.sha,
      leafKind,
      spec: {
        title: stripSubjectPrefix(commit.subject),
        description: commit.body,
        files: touchedFiles,
      },
      diff: {
        baseSha: parentSha,
        touchedFiles,
        changedSymbols,
      },
    });
    seenKinds.add(leafKind);

    if (cases.length >= MIN_CASES && seenKinds.size >= MIN_LEAF_KINDS) break;
  }

  return cases;
}

export const CORPUS: CorpusCase[] = buildCorpus();
