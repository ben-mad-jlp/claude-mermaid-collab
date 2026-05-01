/**
 * BindingSweeper — periodically scans for stale mermaid-collab binding files
 * in /tmp and removes any whose associated Claude process is no longer alive.
 * Binding files are JSON files written by the session handshake and contain a
 * `claudePid` field identifying the owning process. If that process is gone
 * (ESRCH), the file is deleted so that ports and session IDs are not kept
 * occupied indefinitely.
 */

import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

export class BindingSweeper {
  private _interval: ReturnType<typeof setInterval> | null = null;

  async sweepOnce(): Promise<void> {
    const allFiles = await fsp.readdir('/tmp').catch(() => [] as string[]);
    const bindingFiles = allFiles
      .filter(f => f.startsWith('.mermaid-collab-binding-') && f.endsWith('.json'))
      .map(f => path.join('/tmp', f));

    for (const filePath of bindingFiles) {
      try {
        const raw = await fsp.readFile(filePath, 'utf8');
        const data = JSON.parse(raw) as { claudePid?: unknown };
        const { claudePid } = data;

        if (claudePid == null) {
          continue;
        }

        let dead = false;
        try {
          process.kill(Number(claudePid), 0);
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ESRCH') {
            dead = true;
          }
        }

        if (dead) {
          await fsp.unlink(filePath);
          console.log('[binding-sweeper] deleted stale binding:', filePath);
        }
      } catch {
        // Per-file errors are silently ignored to avoid aborting the sweep.
      }
    }
  }

  start(): void {
    void this.sweepOnce().catch(console.error);
    this._interval = setInterval(
      () => void this.sweepOnce().catch(console.error),
      10 * 60 * 1000,
    );
    if (typeof this._interval.unref === 'function') {
      this._interval.unref();
    }
  }

  stop(): void {
    if (this._interval !== null) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}
