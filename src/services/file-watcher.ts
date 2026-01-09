import chokidar from 'chokidar';
import { basename } from 'path';
import { config } from '../config';

export type FileChangeEvent = {
  type: 'created' | 'modified' | 'deleted';
  id: string;
  path: string;
};

export class FileWatcher {
  private watcher?: chokidar.FSWatcher;
  private listeners: Set<(event: FileChangeEvent) => void> = new Set();

  start(): void {
    this.watcher = chokidar.watch(`${config.DIAGRAMS_FOLDER}/*.mmd`, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (path) => {
      const id = basename(path, '.mmd');
      this.emit({ type: 'created', id, path });
    });

    this.watcher.on('change', (path) => {
      const id = basename(path, '.mmd');
      this.emit({ type: 'modified', id, path });
    });

    this.watcher.on('unlink', (path) => {
      const id = basename(path, '.mmd');
      this.emit({ type: 'deleted', id, path });
    });
  }

  stop(): void {
    this.watcher?.close();
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
