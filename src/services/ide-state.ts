import type { ServerWebSocket } from 'bun';
import { Glob } from 'bun';
import { promises as fsp } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

export class IdeState {
  private connectedWs: ServerWebSocket<{ subscriptions: Set<string> }> | null = null;
  private connectedAt: Date | null = null;
  private openDiffs: Set<string> = new Set();
  private workspaceFolders: string[] = [];

  async ideConnected(ws: ServerWebSocket<{ subscriptions: Set<string> }>, workspaceFolders: string[]): Promise<void> {
    this.connectedWs = ws;
    this.connectedAt = new Date();
    this.workspaceFolders = workspaceFolders;

    const glob = new Glob('/tmp/.mermaid-collab-binding-*.json');
    const matches: Array<{ claudeSessionId: string; project: string; session: string; claudePid: string; boundAt: string }> = [];

    for await (const filePath of glob.scan('/')) {
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

        // Check project match
        const projectMatches = workspaceFolders.some(
          f => project === f || project?.startsWith(f + '/')
        );
        if (!projectMatches) continue;

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
        const result = spawnSync('git', ['diff', '--name-only'], { cwd: dir, encoding: 'utf-8' });
        if (result.status !== 0) continue;
        const modifiedRelative = (result.stdout as string)
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);

        // Resolve relative paths from git diff against tracked openDiffs
        // git diff --name-only returns paths relative to repo root
        // We need to find repo root: use git rev-parse
        const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf-8' });
        if (rootResult.status !== 0) continue;
        const repoRoot = (rootResult.stdout as string).trim();

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
    }

    this.openDiffs.clear();
  }

  getStatus(): { connected: boolean; connectedAt: string | null } {
    return {
      connected: this.connectedWs !== null,
      connectedAt: this.connectedAt?.toISOString() ?? null,
    };
  }
}

export const ideState = new IdeState();
