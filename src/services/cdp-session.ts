import { promises as fsp } from 'node:fs';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CDP = require('chrome-remote-interface') as any;

export const CDP_PORT = 9333;

// Maps sessionName → targetId
const tabRegistry = new Map<string, string>();

const TABS_PERSIST_FILE = '/tmp/.mermaid-collab-tabs.json';

function persistTabRegistry(): void {
  try {
    const data: Record<string, string> = {};
    tabRegistry.forEach((targetId, session) => { data[session] = targetId; });
    writeFileSync(TABS_PERSIST_FILE, JSON.stringify(data), 'utf-8');
  } catch {}
}

export async function closePersistedTabs(port: number): Promise<void> {
  try {
    const raw = readFileSync(TABS_PERSIST_FILE, 'utf-8');
    const data = JSON.parse(raw) as Record<string, string>;
    try { unlinkSync(TABS_PERSIST_FILE); } catch {}
    for (const targetId of Object.values(data)) {
      try { await CDP.Close({ id: targetId, host: '127.0.0.1', port }); } catch {}
    }
  } catch {}
}

// Maps Claude PID → collab session name (in-process, survives file-lookup failures)
const pidToSession = new Map<number, string>();

export function registerPidSession(pid: number, session: string): void {
  pidToSession.set(pid, session);
}

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

    // Check in-memory map first (populated by register_claude_session)
    const inMemory = pidToSession.get(pid);
    if (inMemory) return inMemory;

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
    const targetId = tabRegistry.get(sessionName);
    if (targetId) {
      try { await CDP.Activate({ id: targetId, host: '127.0.0.1', port }); } catch {}
      client = await CDP({ host: '127.0.0.1', port, target: targetId });
    } else {
      throw new Error(`No browser tab open for session "${sessionName}" — call browser_open first`);
    }
  } catch (err: any) {
    if (err?.code === 'ECONNREFUSED') {
      throw new Error(
        `Chrome not reachable on port ${port} — toggle CDP button in VSCodium`
      );
    }
    const msg = err?.message ?? String(err);
    if (msg.includes('webSocketDebuggerUrl') || msg.includes('find(') || msg.includes('Cannot read')) {
      tabRegistry.delete(sessionName);
      throw new Error(`Browser tab for session "${sessionName}" is gone — call browser_open to open a new one`);
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
  persistTabRegistry();
}

export async function createOrReplaceTab(sessionName: string, port: number): Promise<string> {
  try {
    const existingId = tabRegistry.get(sessionName);
    if (existingId) {
      try { await CDP.Close({ id: existingId, host: '127.0.0.1', port }); } catch {}
    }
    // Use Target.createTarget with newWindow:false so the tab opens in the existing Chrome window
    const client = await CDP({ host: '127.0.0.1', port });
    let targetId: string;
    try {
      const { targetId: id } = await client.Target.createTarget({ url: 'about:blank', newWindow: false });
      targetId = id;
    } finally {
      client.close().catch(() => {});
    }
    tabRegistry.set(sessionName, targetId);
    persistTabRegistry();
    return targetId;
  } catch (err: any) {
    if (err?.code === 'ECONNREFUSED') {
      throw new Error(`Chrome not reachable on port ${port} — toggle CDP button in VSCodium`);
    }
    throw err;
  }
}

export async function ensureTab(sessionName: string, port: number): Promise<void> {
  if (!tabRegistry.has(sessionName)) {
    await createOrReplaceTab(sessionName, port);
  }
}

export function listActiveSessions(): string[] {
  return Array.from(tabRegistry.keys());
}
