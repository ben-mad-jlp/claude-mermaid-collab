import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

interface Instance {
  version: 1;
  sessionId: string;
  port: number;
  project: string;
  session: string;
  pid: number;
  startedAt: string;
  serverVersion: string;
}

const INSTANCES_DIR = path.join(os.homedir(), '.mermaid-collab', 'instances');

function isInstance(x: unknown): x is Instance {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.sessionId === 'string'
      && typeof o.port === 'number'
      && typeof o.project === 'string'
      && typeof o.session === 'string';
}

async function readInstanceFile(uri: vscode.Uri): Promise<Instance | null> {
  try {
    const raw = await fs.readFile(uri.fsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isInstance(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sessionIdFromUri(uri: vscode.Uri): string {
  return path.basename(uri.fsPath).replace(/\.json$/, '');
}

async function announceUp(uri: vscode.Uri, knownInstances: Map<string, Instance>): Promise<void> {
  const inst = await readInstanceFile(uri);
  if (!inst) return;
  knownInstances.set(inst.sessionId, inst);
  try {
    await vscode.commands.executeCommand('mermaidCollab.ui.onInstanceUp', inst);
  } catch (err) {
    console.warn(`[workspace-half] onInstanceUp dispatch failed:`, err);
  }
}

async function announceDown(sessionId: string, knownInstances: Map<string, Instance>): Promise<void> {
  knownInstances.delete(sessionId);
  try {
    await vscode.commands.executeCommand('mermaidCollab.ui.onInstanceDown', { sessionId });
  } catch (err) {
    console.warn(`[workspace-half] onInstanceDown dispatch failed:`, err);
  }
}

async function instanceState(known: Instance): Promise<'alive' | 'dead' | 'replaced'> {
  const filePath = path.join(INSTANCES_DIR, known.sessionId + '.json');
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return 'dead';
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'dead';
  }
  if (typeof parsed?.startedAt !== 'string') return 'dead';
  if (parsed.startedAt !== known.startedAt) return 'replaced';
  if (typeof known.pid !== 'number') return 'alive';
  try {
    process.kill(known.pid, 0);
    return 'alive';
  } catch {
    return 'dead';
  }
}

export async function activateWorkspace(ctx: vscode.ExtensionContext): Promise<void> {
  const known = new Map<string, Instance>();

  try {
    await fs.mkdir(INSTANCES_DIR, { recursive: true });
  } catch (err) {
    console.warn(`[workspace-half] mkdir ${INSTANCES_DIR} failed:`, err);
  }

  // Initial scan
  try {
    const files = await fs.readdir(INSTANCES_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const uri = vscode.Uri.file(path.join(INSTANCES_DIR, f));
      await announceUp(uri, known);
    }
  } catch (err) {
    console.warn(`[workspace-half] initial scan failed:`, err);
  }

  // File watcher
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(INSTANCES_DIR), '*.json')
  );
  ctx.subscriptions.push(watcher);
  watcher.onDidCreate(uri => { void announceUp(uri, known); });
  watcher.onDidChange(uri => { void announceUp(uri, known); });
  watcher.onDidDelete(uri => { void announceDown(sessionIdFromUri(uri), known); });

  // 30s polling fallback (NFS-homed $HOME, etc.)
  const pollTimer = setInterval(async () => {
    try {
      const filesNow = new Set<string>();
      let entries: string[] = [];
      try { entries = await fs.readdir(INSTANCES_DIR); } catch { return; }
      for (const f of entries) {
        if (!f.endsWith('.json')) continue;
        const id = f.replace(/\.json$/, '');
        filesNow.add(id);
        if (!known.has(id)) {
          await announceUp(vscode.Uri.file(path.join(INSTANCES_DIR, f)), known);
        }
      }
      // Sweep: any known sessionId no longer on disk OR whose process is dead/replaced
      for (const [id, inst] of known) {
        if (!filesNow.has(id)) {
          await announceDown(id, known);
          continue;
        }
        const state = await instanceState(inst);
        if (state === 'dead') {
          await announceDown(id, known);
        } else if (state === 'replaced') {
          await announceDown(id, known);
          await announceUp(vscode.Uri.file(path.join(INSTANCES_DIR, id + '.json')), known);
        }
      }
    } catch (err) {
      console.warn(`[workspace-half] poll failed:`, err);
    }
  }, 30_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(pollTimer) });
}
