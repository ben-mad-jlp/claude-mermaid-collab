/**
 * Pseudo Orphan Detection
 *
 * Walks .collab/pseudo/prose/**.json, classifies each against current
 * source set + git recent-file set, produces fuzzy suggestions, writes
 * orphan_prose rows.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Database } from 'bun:sqlite';

import { readProseFile } from './pseudo-prose-file.js';

export interface OrphanSuggestion {
  file_path: string;
  score: number;
  reason: string;
}

export interface OrphanReport {
  crossBranch: Array<{ prose_file_path: string; source_path: string }>;
  actualOrphans: Array<{
    prose_file_path: string;
    source_path: string;
    suggestions: OrphanSuggestion[];
  }>;
}

export interface OrphanOptions {
  signal?: AbortSignal;
  sinceDaysAgo?: number;
}

const PROSE_DIR_REL = '.collab/pseudo/prose';
const DEFAULT_SINCE_DAYS = 30;
const TOP_N_SUGGESTIONS = 3;

export async function runOrphanDetection(
  db: Database,
  project: string,
  opts: OrphanOptions = {},
): Promise<OrphanReport> {
  const signal = opts.signal;
  const sinceDays = opts.sinceDaysAgo ?? DEFAULT_SINCE_DAYS;

  checkAbort(signal);

  const currentSourceSet = loadCurrentSourceSet(db);

  const proseRoot = join(project, PROSE_DIR_REL);
  const proseFiles = listProseFiles(proseRoot);

  checkAbort(signal);

  const recentFiles = await collectRecentFiles(project, sinceDays, signal);

  checkAbort(signal);

  const report: OrphanReport = { crossBranch: [], actualOrphans: [] };

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO orphan_prose
       (prose_file_path, source_path, status, suggestions)
     VALUES (?, ?, ?, ?)`,
  );

  for (const proseFilePath of proseFiles) {
    checkAbort(signal);

    let parsed;
    try {
      parsed = await readProseFile(proseFilePath, project);
    } catch (err) {
      console.warn('[pseudo-orphan] failed to read prose file', proseFilePath, err);
      continue;
    }
    if (!parsed) continue;

    const sourcePath = normPath(parsed.file);
    if (!sourcePath) continue;

    if (currentSourceSet.has(sourcePath)) continue;

    if (recentFiles.has(sourcePath)) {
      try {
        insertStmt.run(proseFilePath, sourcePath, 'cross-branch-orphan', '[]');
      } catch (err) {
        console.warn('[pseudo-orphan] insert cross-branch failed:', err);
      }
      report.crossBranch.push({ prose_file_path: proseFilePath, source_path: sourcePath });
      continue;
    }

    const suggestions = fuzzyMatchSameDirectory(sourcePath, currentSourceSet, TOP_N_SUGGESTIONS);
    try {
      insertStmt.run(proseFilePath, sourcePath, 'orphan-candidate', JSON.stringify(suggestions));
    } catch (err) {
      console.warn('[pseudo-orphan] insert orphan-candidate failed:', err);
    }
    report.actualOrphans.push({
      prose_file_path: proseFilePath,
      source_path: sourcePath,
      suggestions,
    });
  }

  return report;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err: Error & { name: string } = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }
}

function normPath(p: string): string {
  return p.replaceAll('\\', '/');
}

function loadCurrentSourceSet(db: Database): Set<string> {
  const rows = db.query(`SELECT file_path FROM files WHERE stub = 0`).all() as Array<{ file_path: string }>;
  const out = new Set<string>();
  for (const r of rows) out.add(normPath(r.file_path));
  return out;
}

function listProseFiles(proseRoot: string): string[] {
  const out: string[] = [];
  if (!existsSync(proseRoot)) return out;
  const stack: string[] = [proseRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith('.json') && e.name !== '_path_map.json') {
        out.push(full);
      }
    }
  }
  return out;
}

async function collectRecentFiles(
  project: string,
  sinceDays: number,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const out = new Set<string>();
  return await new Promise<Set<string>>((resolve) => {
    let child;
    try {
      child = spawn(
        'git',
        ['log', '--all', '--name-only', `--since=${sinceDays}.days.ago`, '--pretty=format:'],
        { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      console.warn('[pseudo-orphan] git spawn failed:', err);
      resolve(out);
      return;
    }

    const onAbort = () => {
      try { child.kill(); } catch {}
    };
    if (signal) {
      if (signal.aborted) { onAbort(); resolve(out); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lastNl = buf.lastIndexOf('\n');
      if (lastNl < 0) return;
      const ready = buf.slice(0, lastNl);
      buf = buf.slice(lastNl + 1);
      for (const line of ready.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) out.add(normPath(trimmed));
      }
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err) => {
      console.warn('[pseudo-orphan] git log error:', err);
      signal?.removeEventListener('abort', onAbort);
      resolve(out);
    });
    child.on('close', (code) => {
      if (buf.trim()) {
        for (const line of buf.split('\n')) {
          const t = line.trim();
          if (t) out.add(normPath(t));
        }
      }
      if (code !== 0) {
        console.warn(`[pseudo-orphan] git log exited ${code}: ${stderr.trim()}`);
      }
      signal?.removeEventListener('abort', onAbort);
      resolve(out);
    });
  });
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

function nameSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function fuzzyMatchSameDirectory(
  sourcePath: string,
  currentSourceSet: Set<string>,
  topN: number,
): OrphanSuggestion[] {
  const targetDir = dirname(sourcePath);
  const targetBase = basename(sourcePath);
  const out: OrphanSuggestion[] = [];

  for (const candidate of currentSourceSet) {
    const candDir = dirname(candidate);
    if (candDir !== targetDir) continue;

    const candBase = basename(candidate);
    const sim = nameSimilarity(targetBase, candBase);
    if (sim <= 0) continue;

    const score = Math.min(1, sim * 0.7 + 0.3);
    out.push({
      file_path: candidate,
      score,
      reason: `same-dir, basename~${sim.toFixed(2)}`,
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, topN);
}
