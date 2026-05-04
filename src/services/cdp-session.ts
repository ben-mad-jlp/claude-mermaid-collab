import { promises as fsp } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CDP = require('chrome-remote-interface') as any;

export const CDP_PORT = 9333;

// Maps sessionName → targetId
const tabRegistry = new Map<string, string>();

export async function resolveSessionId(claudePid?: number): Promise<string> {
  try {
    let pid = claudePid;
    if (!pid || !Number.isInteger(pid) || pid === 0) {
      const envPid = Number(process.env.CLAUDE_PID);
      if (Number.isInteger(envPid) && envPid !== 0) {
        pid = envPid;
      }
    }

    if (!pid || !Number.isInteger(pid) || pid === 0) {
      return `auto-${process.pid}`;
    }

    const sessionIdRaw = await fsp.readFile(`/tmp/.claude-session-id-${pid}`, 'utf8');
    const claudeSessionId = sessionIdRaw.trim();

    const bindingRaw = await fsp.readFile(
      `/tmp/.mermaid-collab-binding-${claudeSessionId}.json`,
      'utf8'
    );
    const binding = JSON.parse(bindingRaw);

    return binding.session as string;
  } catch {
    return `auto-${process.pid}`;
  }
}

export async function withCDPSession<T>(
  sessionName: string,
  port: number,
  fn: (client: any) => Promise<T>
): Promise<T> {
  let client: any;
  try {
    client = await CDP({ host: '127.0.0.1', port });
  } catch (err: any) {
    if (err?.code === 'ECONNREFUSED') {
      throw new Error(
        `Chrome not reachable on port ${port} — toggle CDP button in VSCodium`
      );
    }
    throw err;
  }

  try {
    return await fn(client);
  } finally {
    client.close().catch(() => {});
  }
}

export async function focusTab(sessionName: string, port: number): Promise<void> {
  try {
    let targetId = tabRegistry.get(sessionName);

    if (!targetId) {
      const tabs = await CDP.List({ host: '127.0.0.1', port });
      const pageTab = tabs.find((t: any) => t.type === 'page');
      if (pageTab) {
        targetId = pageTab.id;
      }
    }

    if (targetId) {
      await CDP.Activate({ id: targetId, host: '127.0.0.1', port });
    }
  } catch (err: any) {
    if (err?.code === 'ECONNREFUSED') {
      throw new Error(
        `Chrome not reachable on port ${port} — toggle CDP button in VSCodium`
      );
    }
    throw err;
  }
}

export function registerTab(sessionName: string, tabId: string): void {
  tabRegistry.set(sessionName, tabId);
}

export async function createOrReplaceTab(sessionName: string, port: number): Promise<string> {
  try {
    const existingId = tabRegistry.get(sessionName);
    if (existingId) {
      try { await CDP.Close({ id: existingId, host: '127.0.0.1', port }); } catch {}
    }
    const tab = await CDP.New({ host: '127.0.0.1', port });
    tabRegistry.set(sessionName, tab.id);
    return tab.id;
  } catch (err: any) {
    if (err?.code === 'ECONNREFUSED') {
      throw new Error(`Chrome not reachable on port ${port} — toggle CDP button in VSCodium`);
    }
    throw err;
  }
}

export function listActiveSessions(): string[] {
  return Array.from(tabRegistry.keys());
}
