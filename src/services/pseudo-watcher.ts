/**
 * Pseudo Watcher — chokidar-based file watcher feeding incremental indexer scans.
 */

import { join, isAbsolute, resolve } from 'node:path';
import type { PseudoIndexer } from './pseudo-indexer.js';
import { SCANNER_EXCLUDES } from './source-scanner.js';
import { readProseFile } from './pseudo-prose-file.js';

export interface PseudoWatcherOptions {
  debounceMs?: number;
}

export interface PseudoWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const PROSE_DIR_REL = '.collab/pseudo/prose';
const DEFAULT_DEBOUNCE_MS = 100;

export function createPseudoWatcher(
  project: string,
  indexer: PseudoIndexer,
  opts?: PseudoWatcherOptions,
): PseudoWatcher {
  const debounceMs = opts?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const projectAbs = isAbsolute(project) ? project : resolve(project);
  const proseRoot = join(projectAbs, PROSE_DIR_REL);

  let started = false;
  let stopped = false;
  let chokidarMod: typeof import('chokidar') | null = null;
  let sourceWatcher: import('chokidar').FSWatcher | null = null;
  let proseWatcher: import('chokidar').FSWatcher | null = null;

  const pending = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let currentFlush: Promise<void> | null = null;

  function isProsePath(p: string): boolean {
    const abs = isAbsolute(p) ? p : resolve(projectAbs, p);
    return abs.startsWith(proseRoot + '/') || abs === proseRoot;
  }

  function enqueue(path: string): void {
    if (stopped) return;
    pending.add(path);
    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        currentFlush = flush();
        currentFlush.finally(() => { currentFlush = null; });
      }, debounceMs);
    }
  }

  async function flush(): Promise<void> {
    if (pending.size === 0) return;
    const batch = Array.from(pending);
    pending.clear();

    const sourcePaths: string[] = [];
    const prosePaths: string[] = [];
    for (const p of batch) {
      if (isProsePath(p)) prosePaths.push(p);
      else sourcePaths.push(p);
    }

    if (sourcePaths.length > 0) {
      try {
        await indexer.runIncrementalScan(sourcePaths, { trigger: 'watcher' });
      } catch (err) {
        console.error(
          `[pseudo-watcher] runIncrementalScan failed for ${sourcePaths.length} file(s):`,
          (err as Error).message,
        );
      }
    }

    for (const prosePath of prosePaths) {
      try {
        const prose = await readProseFile(prosePath);
        if (!prose) continue;
        const sourceRel = prose.file;
        const sourceAbs = isAbsolute(sourceRel) ? sourceRel : resolve(projectAbs, sourceRel);
        await indexer.runIncrementalScanForFile(sourceAbs, { trigger: 'watcher' });
      } catch (err) {
        console.error(
          `[pseudo-watcher] prose reload failed for ${prosePath}:`,
          (err as Error).message,
        );
      }
    }
  }

  async function start(): Promise<void> {
    if (started) return;
    started = true;

    try {
      chokidarMod = (await import('chokidar')) as typeof import('chokidar');
    } catch (err) {
      console.warn(
        `[pseudo-watcher] chokidar unavailable, watcher disabled: ${(err as Error).message}`,
      );
      chokidarMod = null;
      return;
    }

    const excludeNames = SCANNER_EXCLUDES;
    const ignoreFn = (p: string): boolean => {
      const segments = p.split(/[\\/]/);
      for (const seg of segments) {
        if (excludeNames.has(seg)) return true;
      }
      return false;
    };

    sourceWatcher = chokidarMod.watch(projectAbs, {
      persistent: true,
      ignoreInitial: true,
      ignored: ignoreFn,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    sourceWatcher.on('add', enqueue);
    sourceWatcher.on('change', enqueue);
    sourceWatcher.on('unlink', enqueue);
    sourceWatcher.on('error', (err) => {
      console.error('[pseudo-watcher] source watcher error:', (err as Error).message);
    });

    proseWatcher = chokidarMod.watch(proseRoot, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    proseWatcher.on('add', enqueue);
    proseWatcher.on('change', enqueue);
    proseWatcher.on('unlink', enqueue);
    proseWatcher.on('error', (err) => {
      console.error('[pseudo-watcher] prose watcher error:', (err as Error).message);
    });
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending.clear();
    if (currentFlush) {
      try { await currentFlush; } catch {}
    }
    const closes: Promise<void>[] = [];
    if (sourceWatcher) closes.push(sourceWatcher.close());
    if (proseWatcher) closes.push(proseWatcher.close());
    sourceWatcher = null;
    proseWatcher = null;
    await Promise.all(closes);
  }

  return { start, stop };
}
