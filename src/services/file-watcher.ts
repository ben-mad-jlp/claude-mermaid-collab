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
    const diagramWatcher = chokidar.watch(`${config.DIAGRAMS_FOLDER}/*.mmd`, {
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

    // Watch documents
    const documentWatcher = chokidar.watch(`${config.DOCUMENTS_FOLDER}/*.md`, {
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
