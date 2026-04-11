/**
 * Pseudo Drift Checker — Layer 2 periodic + Layer 3 idle drift detection.
 */

import { createHash } from 'node:crypto';
import { promises as fsp, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Database } from 'bun:sqlite';

import type { PseudoIndexer } from './pseudo-indexer.js';

export interface DriftCheckerOptions {
  periodicIntervalMs?: number;
  idleCheckMs?: number;
}

export interface DriftReport {
  checkedFiles: number;
  changedFiles: string[];
}

export interface DriftChecker {
  start(): void;
  stop(): Promise<void>;
  checkNow(mode: 'stat' | 'hash_sample' | 'full'): Promise<DriftReport>;
  touch(): void;
}

const DEFAULT_PERIODIC_MS = 5 * 60_000;
const DEFAULT_IDLE_MS = 30_000;
const HASH_SAMPLE_FRACTION = 0.1;

function sha1(buf: Buffer | string): string {
  return createHash('sha1').update(buf).digest('hex');
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function gitLsFiles(project: string): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['ls-files', '-z'], { cwd: project });
    const chunks: Buffer[] = [];
    let errored = false;
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.on('error', () => { errored = true; resolve([]); });
    proc.on('close', (code) => {
      if (errored) return;
      if (code !== 0) { resolve([]); return; }
      const out = Buffer.concat(chunks).toString('utf8');
      const parts = out.split('\0').filter((s) => s.length > 0);
      resolve(parts);
    });
  });
}

export function createDriftChecker(
  project: string,
  db: Database,
  indexer: PseudoIndexer,
  opts: DriftCheckerOptions = {},
): DriftChecker {
  const periodicIntervalMs = opts.periodicIntervalMs ?? DEFAULT_PERIODIC_MS;
  const idleCheckMs = opts.idleCheckMs ?? DEFAULT_IDLE_MS;

  let periodicTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let scanActive = false;
  let currentCheck: Promise<DriftReport> | null = null;

  async function checkStat(): Promise<DriftReport> {
    const paths = await gitLsFiles(project);
    const changed: string[] = [];

    const indexedRows = db
      .query(`SELECT file_path, scanned_at FROM files`)
      .all() as Array<{ file_path: string; scanned_at: string | null }>;
    const indexedMap = new Map<string, string | null>();
    for (const r of indexedRows) indexedMap.set(r.file_path, r.scanned_at);

    let checkedCount = 0;
    for (const rel of paths) {
      const abs = join(project, rel);
      const scannedAt = indexedMap.get(abs);
      if (!scannedAt) continue;
      checkedCount++;
      try {
        const st = statSync(abs);
        const mtimeIso = st.mtime.toISOString();
        if (mtimeIso > scannedAt) changed.push(abs);
      } catch {}
    }

    for (const c of changed) {
      try {
        await indexer.runIncrementalScanForFile(c, { trigger: 'reconcile' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/scan already in progress/i.test(msg)) {
          console.warn('[pseudo-drift] reindex failed for', c, msg);
        }
      }
    }

    return { checkedFiles: checkedCount, changedFiles: changed };
  }

  async function checkHashSample(): Promise<DriftReport> {
    const rows = db
      .query(`SELECT file_path, source_hash FROM files WHERE stub = 0`)
      .all() as Array<{ file_path: string; source_hash: string }>;
    if (rows.length === 0) return { checkedFiles: 0, changedFiles: [] };

    const sampleSize = Math.max(1, Math.floor(rows.length * HASH_SAMPLE_FRACTION));
    const sample = shuffle(rows).slice(0, sampleSize);

    const changed: string[] = [];
    for (const r of sample) {
      try {
        const content = await fsp.readFile(r.file_path);
        const currentHash = sha1(content);
        if (currentHash !== r.source_hash) changed.push(r.file_path);
      } catch {}
    }

    for (const c of changed) {
      try {
        await indexer.runIncrementalScanForFile(c, { trigger: 'reconcile' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/scan already in progress/i.test(msg)) {
          console.warn('[pseudo-drift] reindex failed for', c, msg);
        }
      }
    }

    return { checkedFiles: sampleSize, changedFiles: changed };
  }

  async function checkNow(mode: 'stat' | 'hash_sample' | 'full'): Promise<DriftReport> {
    if (scanActive) return { checkedFiles: 0, changedFiles: [] };
    scanActive = true;
    const p = (async () => {
      try {
        if (mode === 'stat') return await checkStat();
        if (mode === 'hash_sample') return await checkHashSample();
        const a = await checkStat();
        const b = await checkHashSample();
        return {
          checkedFiles: a.checkedFiles + b.checkedFiles,
          changedFiles: [...a.changedFiles, ...b.changedFiles],
        };
      } finally {
        scanActive = false;
        currentCheck = null;
      }
    })();
    currentCheck = p;
    return p;
  }

  function armIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void checkNow('hash_sample')
        .catch((err) => console.warn('[pseudo-drift] idle hash_sample failed:', err))
        .finally(() => {
          if (idleTimer !== null) armIdleTimer();
        });
    }, idleCheckMs);
    if (typeof (idleTimer as any).unref === 'function') {
      (idleTimer as any).unref();
    }
  }

  function touch(): void {
    if (idleTimer === null && periodicTimer === null) return;
    armIdleTimer();
  }

  function start(): void {
    if (periodicTimer !== null) return;
    periodicTimer = setInterval(() => {
      void checkNow('stat').catch((err) =>
        console.warn('[pseudo-drift] periodic stat failed:', err),
      );
    }, periodicIntervalMs);
    if (typeof (periodicTimer as any).unref === 'function') {
      (periodicTimer as any).unref();
    }
    armIdleTimer();
  }

  async function stop(): Promise<void> {
    if (currentCheck) {
      try { await currentCheck; } catch {}
    }
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  return { start, stop, checkNow, touch };
}
