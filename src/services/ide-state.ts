import type { ServerWebSocket } from 'bun';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

interface BrowserPending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class IdeState {
  private connectedWs: ServerWebSocket<{ subscriptions: Set<string> }> | null = null;
  private connectedAt: Date | null = null;
  private openDiffs: Set<string> = new Set();
  private workspaceFolders: string[] = [];
  private browserPending = new Map<string, BrowserPending>();

  async ideConnected(ws: ServerWebSocket<{ subscriptions: Set<string> }>, workspaceFolders: string[]): Promise<void> {
    if (this.connectedWs && this.connectedWs !== ws) {
      this.ideDisconnected(this.connectedWs);
    }
    this.connectedWs = ws;
    this.connectedAt = new Date();
    this.workspaceFolders = workspaceFolders;

    console.log('[ide-state] ideConnected workspaceFolders:', workspaceFolders);
    const matches: Array<{ claudeSessionId: string; project: string; session: string; claudePid: string; boundAt: string }> = [];

    const allFiles = await fsp.readdir('/tmp');
    const bindingFiles = allFiles
      .filter(f => f.startsWith('.mermaid-collab-binding-') && f.endsWith('.json'))
      .map(f => path.join('/tmp', f));

    for (const filePath of bindingFiles) {
      try {
        const raw = await fsp.readFile(filePath, 'utf-8');
        const data = JSON.parse(raw) as {
          claudeSessionId: string;
          project: string;
          session: string;
          claudePid: string;
          boundAt: string;
        };
        const { claudeSessionId, project, session, claudePid, boundAt } = data;

        // Check pid alive
        try {
          process.kill(Number(claudePid), 0);
        } catch {
          continue;
        }

        // Check project match (skip filter if no workspace folders provided)
        if (workspaceFolders.length > 0) {
          const projectMatches = workspaceFolders.some(
            f => project === f || project?.startsWith(f + '/')
          );
          if (!projectMatches) continue;
        }

        matches.push({ claudeSessionId, project, session, claudePid, boundAt });
      } catch {
        // skip per-file errors
      }
    }

    // Sort by boundAt descending
    matches.sort((a, b) => {
      const aTime = new Date(a.boundAt).getTime();
      const bTime = new Date(b.boundAt).getTime();
      return bTime - aTime;
    });

    console.log('[ide-state] matches found:', matches.map(m => m.session));
    for (const { claudeSessionId, project, session, claudePid, boundAt } of matches) {
      ws.send(JSON.stringify({
        type: 'ide_reattach',
        claudeSessionId,
        project,
        session,
        claudePid: Number(claudePid),
        boundAt,
      }));
    }

    await this.refireOpenDiffs();
  }

  ideDisconnected(ws: ServerWebSocket<{ subscriptions: Set<string> }>): void {
    if (this.connectedWs !== ws) return;
    this.connectedWs = null;
    this.connectedAt = null;
    this.openDiffs.clear();
    this.workspaceFolders = [];
  }

  diffOpened(filePath: string): void {
    this.openDiffs.add(filePath);
  }

  private async bunExec(args: string[], cwd: string): Promise<{ status: number; stdout: string }> {
    const proc = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'ignore' });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    return { status: proc.exitCode ?? 1, stdout };
  }

  async refireOpenDiffs(): Promise<void> {
    if (this.openDiffs.size === 0) return;

    // Collect unique parent directories for the tracked files
    const uniqueDirs = new Set<string>();
    for (const filePath of this.openDiffs) {
      uniqueDirs.add(path.dirname(filePath));
    }

    // For each unique dir, get the git-modified files relative to that repo root
    // Map: absolute filePath -> still modified?
    const stillModified = new Set<string>();

    for (const dir of uniqueDirs) {
      try {
        const result = await this.bunExec(['git', 'diff', '--name-only'], dir);
        if (result.status !== 0) continue;
        const modifiedRelative = result.stdout
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);

        // Resolve relative paths from git diff against tracked openDiffs
        // git diff --name-only returns paths relative to repo root
        // We need to find repo root: use git rev-parse
        const rootResult = await this.bunExec(['git', 'rev-parse', '--show-toplevel'], dir);
        if (rootResult.status !== 0) continue;
        const repoRoot = rootResult.stdout.trim();

        for (const rel of modifiedRelative) {
          const absolutePath = path.join(repoRoot, rel);
          stillModified.add(absolutePath);
        }
      } catch {
        // skip errors for this dir
      }
    }

    if (this.connectedWs) {
      for (const filePath of this.openDiffs) {
        if (stillModified.has(filePath)) {
          this.connectedWs.send(JSON.stringify({ type: 'ide_open_diff', filePath }));
        }
      }
      this.openDiffs.clear();
    }
  }

  getStatus(): { connected: boolean; connectedAt: string | null } {
    return {
      connected: this.connectedWs !== null,
      connectedAt: this.connectedAt?.toISOString() ?? null,
    };
  }

  waitForBrowserResponse<T = unknown>(requestId: string, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.browserPending.delete(requestId);
        reject(new Error('Browser request timed out'));
      }, timeoutMs);
      this.browserPending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
    });
  }

  resolveBrowserRequest(requestId: string, result?: unknown, error?: string): void {
    const p = this.browserPending.get(requestId);
    if (!p) return;
    this.browserPending.delete(requestId);
    clearTimeout(p.timer);
    if (error) p.reject(new Error(error));
    else p.resolve(result);
  }
}

export const ideState = new IdeState();
