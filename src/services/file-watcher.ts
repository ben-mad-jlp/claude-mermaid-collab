import chokidar from 'chokidar';
import { basename } from 'path';
import { config } from '../config';

export type FileChangeEvent = {
  type: 'created' | 'modified' | 'deleted';
  resourceType: 'diagram' | 'document';
  id: string;
  path: string;
};

export class FileWatcher {
  private watcher?: chokidar.FSWatcher;
  private documentWatcher?: chokidar.FSWatcher;
  private listeners: Set<(event: FileChangeEvent) => void> = new Set();

  start(): void {
    // Watch diagrams
    // NOTE: This legacy watcher is not wired into the current session-aware
    // server and retains the old flat-folder layout. `config` no longer
    // exposes `DIAGRAMS_FOLDER` / `DOCUMENTS_FOLDER`, so we fall back to
    // reasonable defaults under `PUBLIC_DIR`.
    const diagramsFolder = (config as any).DIAGRAMS_FOLDER || `${config.PUBLIC_DIR}/diagrams`;
    const diagramWatcher = chokidar.watch(`${diagramsFolder}/*.mmd`, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    diagramWatcher.on('add', (path) => {
      const id = basename(path, '.mmd');
      this.emit({ type: 'created', resourceType: 'diagram', id, path });
    });

    diagramWatcher.on('change', (path) => {
      const id = basename(path, '.mmd');
      this.emit({ type: 'modified', resourceType: 'diagram', id, path });
    });

    diagramWatcher.on('unlink', (path) => {
      const id = basename(path, '.mmd');
      this.emit({ type: 'deleted', resourceType: 'diagram', id, path });
    });

    // Watch documents (see note above about legacy layout)
    const documentsFolder = (config as any).DOCUMENTS_FOLDER || `${config.PUBLIC_DIR}/documents`;
    const documentWatcher = chokidar.watch(`${documentsFolder}/*.md`, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    documentWatcher.on('add', (path) => {
      const id = basename(path, '.md');
      this.emit({ type: 'created', resourceType: 'document', id, path });
    });

    documentWatcher.on('change', (path) => {
      const id = basename(path, '.md');
      this.emit({ type: 'modified', resourceType: 'document', id, path });
    });

    documentWatcher.on('unlink', (path) => {
      const id = basename(path, '.md');
      this.emit({ type: 'deleted', resourceType: 'document', id, path });
    });

    this.watcher = diagramWatcher;
    this.documentWatcher = documentWatcher;
  }

  stop(): void {
    this.watcher?.close();
    this.documentWatcher?.close();
    this.watcher = undefined;
    this.documentWatcher = undefined;
  }

  /**
   * Restart the file watcher. Use after changing storage directory.
   */
  restart(): void {
    this.stop();
    this.start();
  }

  onChange(listener: (event: FileChangeEvent) => void): void {
    this.listeners.add(listener);
  }

  private emit(event: FileChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
