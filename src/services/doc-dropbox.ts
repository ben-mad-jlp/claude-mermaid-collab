import chokidar, { type FSWatcher } from 'chokidar';
import { readFile, rename, mkdir, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import { DocumentManager } from './document-manager';

export interface DocDropboxOptions {
  dropDir: string;          // config.DOC_DROP_DIR — absolute path, watcher root
  documentManager: DocumentManager; // target session's document store
  sessionLabel: string;     // for the imported doc-name prefix / logging, e.g. "default"
  debounceMs?: number;      // default 1500 — size-stable check interval
}

export interface DocDropboxHandle {
  close(): Promise<void>;
  /** Resolves once the underlying watcher has completed its initial scan and is
   *  watching for real-time changes. Exposed so tests can avoid racing writes
   *  against chokidar's initial-scan window. */
  whenReady(): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 1500;

/** Whether the watched inbox drop dir should start — gated on MERMAID_DOC_DROP_DIR
 *  being a non-empty path. Exported so callers (and tests) can check the gate
 *  without spinning up a real watcher. */
export function shouldStartDocDropbox(dir: string): boolean {
  return Boolean(dir);
}

/** True when a *.md file's size is unchanged across two reads `debounceMs` apart
 *  (partial-write guard — a file mid-copy/mid-write keeps growing). */
export async function isSizeStable(path: string, debounceMs: number): Promise<boolean> {
  const first = await stat(path);
  await new Promise((resolve) => setTimeout(resolve, debounceMs));
  const second = await stat(path);
  return first.size === second.size;
}

/** Derives the imported document name: `from-<fileOwnerOrStem>-<name>`.
 *  fileOwnerOrStem = the file's basename without extension when no owner can be
 *  determined from the path (single-user/dev case); on the Linux deployment the
 *  caller passes the owning path segment (e.g. dropDir's <user> leaf) via `owner`. */
export function dropDocName(filePath: string, owner?: string): string {
  const stem = basename(filePath, extname(filePath));
  const ownerOrStem = owner && owner.trim() ? owner.trim() : stem;
  return `from-${ownerOrStem}-${stem}`;
}

/** Starts the chokidar watcher on `opts.dropDir` for `*.md` files. Debounces via
 *  isSizeStable before importing. On stable import: DocumentManager.createDocument(name, content),
 *  then moves the source file into `<dropDir>/processed/`. Never throws — watcher errors are
 *  logged and swallowed, matching bonjour-advertiser's never-throw contract. */
export function startDocDropbox(opts: DocDropboxOptions): DocDropboxHandle {
  const { dropDir, documentManager, debounceMs = DEFAULT_DEBOUNCE_MS } = opts;
  const processedDir = join(dropDir, 'processed');

  const readyPromise = Promise.all([
    mkdir(dropDir, { recursive: true }),
    mkdir(processedDir, { recursive: true }),
  ]).catch((err) => {
    console.warn(`[doc-dropbox] failed to create drop dirs (ignored): ${String(err)}`);
  });

  let watcher: FSWatcher | null = null;
  let resolveReady: () => void = () => {};
  const watcherReadyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const watchStartPromise = readyPromise.then(() => {
    watcher = chokidar.watch(join(dropDir, '*.md'), {
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: debounceMs,
        pollInterval: Math.min(debounceMs, 300),
      },
    });

    watcher.on('add', async (path: string) => {
      try {
        if (extname(path) !== '.md') return;
        const content = await readFile(path, 'utf-8');
        const name = dropDocName(path);
        await documentManager.createDocument(name, content);
        await rename(path, join(processedDir, basename(path)));
      } catch (err) {
        console.warn(`[doc-dropbox] import failed for ${path} (ignored): ${String(err)}`);
      }
    });

    watcher.on('error', (err: unknown) => {
      console.warn(`[doc-dropbox] watcher error (ignored): ${String(err)}`);
    });

    watcher.on('ready', () => resolveReady());
  });

  return {
    async close(): Promise<void> {
      await watchStartPromise;
      if (watcher) {
        await watcher.close();
        watcher = null;
      }
    },
    async whenReady(): Promise<void> {
      await watchStartPromise;
      await watcherReadyPromise;
    },
  };
}
