/**
 * Pseudo Ranking Service
 *
 * Computes per-file priority from git history. Single-pass git log parsed
 * into touch counts + authorship, then UPDATEs files rows.
 */

import { spawn } from 'node:child_process';
import type { Database } from 'bun:sqlite';

export interface FileRanking {
  file_path: string;
  owner: string;
  touch_count_90d: number;
  last_touched: string;
  co_authors: string[];
  priority: number;
}

export interface RankingOptions {
  signal?: AbortSignal;
  sinceDaysAgo?: number;
}

interface RawAggregate {
  commits: Set<string>;
  authors: Map<string, number>;
  last_ts: number;
}

const GENERATED_PATTERNS: RegExp[] = [
  /-generated\./,
  /\.pb\.go$/,
  /\.gen\.ts$/,
  /\.gen\.js$/,
  /\.min\.js$/,
  /\.bundle\.js$/,
  /\.generated\./,
  /_generated\./,
];

function isGeneratedFile(filePath: string): boolean {
  return GENERATED_PATTERNS.some((re) => re.test(filePath));
}

export async function runRanking(
  db: Database,
  project: string,
  opts: RankingOptions = {},
): Promise<number> {
  const sinceDays = opts.sinceDaysAgo ?? 90;
  const signal = opts.signal;

  let raw: string;
  try {
    raw = await spawnGitLog(project, sinceDays, signal);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    console.warn(`[pseudo-ranking] git log failed: ${err?.message ?? err}. Returning 0.`);
    return 0;
  }

  const aggregates = parseGitLog(raw, signal);

  const fileRows = db
    .query(`SELECT file_path, lines FROM files WHERE stub = 0`)
    .all() as Array<{ file_path: string; lines: number }>;

  const updateStmt = db.prepare(
    `UPDATE files
       SET owner = ?, touch_count_90d = ?, last_touched = ?, priority = ?
     WHERE file_path = ?`,
  );

  let updated = 0;
  const txn = db.transaction((rows: Array<{ file_path: string; lines: number }>) => {
    for (const row of rows) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const ranking = computeRanking(row.file_path, row.lines, aggregates);
      const result = updateStmt.run(
        ranking.owner,
        ranking.touch_count_90d,
        ranking.last_touched,
        Math.round(ranking.priority),
        row.file_path,
      );
      if ((result as any).changes > 0) updated++;
    }
  });
  txn(fileRows);

  return updated;
}

function spawnGitLog(
  project: string,
  sinceDays: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const args = [
      'log',
      '--all',
      '--name-only',
      `--since=${sinceDays}.days.ago`,
      '--pretty=format:%H|%at|%ae',
    ];

    const child = spawn('git', args, { cwd: project });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const onAbort = () => {
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort);

    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => errChunks.push(c));

    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString('utf8').trim();
        reject(new Error(`git log exited with code ${code}: ${msg}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function parseGitLog(raw: string, signal?: AbortSignal): Map<string, RawAggregate> {
  const out = new Map<string, RawAggregate>();
  if (!raw) return out;

  const lines = raw.split('\n');
  let i = 0;
  let chunkCount = 0;

  while (i < lines.length) {
    if ((chunkCount++ & 0xff) === 0 && signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    const parts = line.split('|');
    if (parts.length < 3) {
      i++;
      continue;
    }
    const hash = parts[0];
    const ts = Number(parts[1]);
    const email = parts.slice(2).join('|');
    if (!hash || !Number.isFinite(ts)) {
      i++;
      continue;
    }
    i++;

    while (i < lines.length) {
      const fileLine = lines[i];
      if (fileLine === '' || fileLine == null) {
        i++;
        break;
      }
      if (fileLine.includes('|')) {
        const maybe = fileLine.split('|');
        if (maybe.length >= 3 && /^[0-9a-f]{7,40}$/.test(maybe[0]) && Number.isFinite(Number(maybe[1]))) {
          break;
        }
      }

      let agg = out.get(fileLine);
      if (!agg) {
        agg = { commits: new Set(), authors: new Map(), last_ts: 0 };
        out.set(fileLine, agg);
      }
      agg.commits.add(hash);
      agg.authors.set(email, (agg.authors.get(email) ?? 0) + 1);
      if (ts > agg.last_ts) agg.last_ts = ts;

      i++;
    }
  }

  return out;
}

function computeRanking(
  filePath: string,
  lineCount: number,
  aggregates: Map<string, RawAggregate>,
): FileRanking {
  const agg = aggregates.get(filePath);
  const generated = isGeneratedFile(filePath);

  if (!agg || agg.commits.size === 0) {
    return {
      file_path: filePath,
      owner: '',
      touch_count_90d: 0,
      last_touched: '',
      co_authors: [],
      priority: 0,
    };
  }

  let ownerEmail = '';
  let ownerCount = -1;
  for (const [email, count] of agg.authors.entries()) {
    if (count > ownerCount) {
      ownerEmail = email;
      ownerCount = count;
    }
  }

  const coAuthors: string[] = [];
  for (const [email, count] of agg.authors.entries()) {
    if (email !== ownerEmail && count >= 2) coAuthors.push(email);
  }

  const touchCount = agg.commits.size;
  const lastTouched = new Date(agg.last_ts * 1000).toISOString();
  let priority = touchCount * Math.log(Math.max(2, lineCount));
  if (generated) priority *= 0.1;

  return {
    file_path: filePath,
    owner: ownerEmail,
    touch_count_90d: touchCount,
    last_touched: lastTouched,
    co_authors: coAuthors,
    priority,
  };
}
