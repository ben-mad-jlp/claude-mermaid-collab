import { promises as fsp } from 'node:fs';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';

// Static import (not createRequire) so `bun build --compile` bundles
// chrome-remote-interface into the packaged sidecar binary. A dynamic
// createRequire isn't followed by the compiler and resolves against the real
// filesystem at runtime — which has no node_modules inside the .app bundle,
// so the binary crashed on startup with "Cannot find package".
// @ts-ignore - chrome-remote-interface ships no type declarations
import CDPImport from 'chrome-remote-interface';
const CDP = CDPImport as any;

import { CDP_PORT } from '../config.js';
export { CDP_PORT };

let runtimeElectronTarget: { cdpPort: number } | null = null;

export function setElectronTarget(cdpPort: number): void { runtimeElectronTarget = { cdpPort }; }
export function clearElectronTarget(): void { runtimeElectronTarget = null; }

// Maps sessionName → targetId
const tabRegistry = new Map<string, string>();

/**
 * Marker used to identify the Electron embedded browser pane's WebContentsView
 * target among the CDP targets. When MC_BROWSER_TARGET=electron-view, the
 * browser tools select the existing view (whose title/url carries this marker)
 * instead of creating a new target. The browser-pane code must load the pane
 * with this title (or a URL containing it) so the two stay in sync.
 */
export const ELECTRON_VIEW_MARKER = 'mc-browser-pane';

/**
 * Select the Electron embedded browser pane's target from a CDP target list.
 * Pure (no I/O) so it is directly unit-testable. The spike confirmed multiple
 * `page` targets exist, so we match the marker deliberately rather than [0].
 * @throws if no matching `page` target carries the marker.
 */
export function selectElectronViewTarget(tabs: Array<{ id: string; type?: string; title?: string; url?: string }>, session?: string): string {
  if (session) {
    const sessionMarker = ELECTRON_VIEW_MARKER + ':' + session;
    const sessionView = tabs.find(
      (t) =>
        t.type === 'page' &&
        (t.title === sessionMarker || (t.url ?? '').includes(sessionMarker))
    );
    if (sessionView) return sessionView.id;
    // Fallback to bare marker (exact title match only — do NOT use .includes to avoid matching other sessions)
    const bareView = tabs.find(
      (t) => t.type === 'page' && t.title === ELECTRON_VIEW_MARKER
    );
    if (bareView) return bareView.id;
    throw new Error('embedded view target not found');
  }
  // No session: match bare marker (tightened to exact title or url includes)
  const view = tabs.find(
    (t) =>
      t.type === 'page' &&
      (t.title === ELECTRON_VIEW_MARKER || (t.url ?? '').includes(ELECTRON_VIEW_MARKER))
  );
  if (!view) {
    throw new Error('embedded view target not found');
  }
  return view.id;
}

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
      // Only wipe the registry if Chrome confirms the tab is actually gone
      try {
        const tabs = await CDP.List({ host: '127.0.0.1', port });
        const stillExists = tabs.some((t: any) => t.id === tabRegistry.get(sessionName));
        if (!stillExists) tabRegistry.delete(sessionName);
      } catch {}
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

export async function activateTab(sessionName: string, port: number): Promise<void> {
  try {
    const targetId = tabRegistry.get(sessionName);
    if (targetId) {
      await CDP.Activate({ id: targetId, host: '127.0.0.1', port });
    }
  } catch {}
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
    // Electron embedded-view mode: do NOT create a target. Select the existing
    // WebContentsView (identified by ELECTRON_VIEW_MARKER) — the spike confirmed
    // multiple `page` targets exist, so match deliberately rather than picking [0].
    if (runtimeElectronTarget != null || process.env.MC_BROWSER_TARGET === 'electron-view') {
      const effectivePort = runtimeElectronTarget?.cdpPort ?? port;
      const tabs = await CDP.List({ host: '127.0.0.1', port: effectivePort });
      const viewId = selectElectronViewTarget(tabs, sessionName);
      tabRegistry.set(sessionName, viewId);
      persistTabRegistry();
      return viewId;
    }

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

/**
 * Ensure a tab exists for the session:
 * - No entry → create a new tab
 * - Entry exists and Chrome still has the target → focus it, return existing id
 * - Entry exists but Chrome no longer has the target → throw so the caller can decide to replace
 */
export async function ensureTab(sessionName: string, port: number): Promise<string> {
  try {
    // Electron embedded-view mode: ensure the pane via the control server, then
    // select the per-session target. Skip the normal tab-registry path entirely.
    if (runtimeElectronTarget != null || process.env.MC_BROWSER_TARGET === 'electron-view') {
      const effectivePort = runtimeElectronTarget?.cdpPort ?? port;
      if (process.env.MC_DESKTOP_CONTROL_URL) {
        try {
          const res = await fetch(`${process.env.MC_DESKTOP_CONTROL_URL}/panes/ensure`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.MC_DESKTOP_CONTROL_TOKEN ?? ''}` },
            body: JSON.stringify({ session: sessionName }),
          });
          if (!res.ok) throw new Error(`desktop control /panes/ensure failed for session '${sessionName}': HTTP ${res.status}`);
        } catch (e) {
          throw new Error(`failed to ensure desktop browser pane for session '${sessionName}': ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      let tabs: any[];
      try {
        tabs = await CDP.List({ host: '127.0.0.1', port: effectivePort });
      } catch (err: any) {
        if (err?.code === 'ECONNREFUSED') {
          throw new Error(`Chrome not reachable on port ${effectivePort} — toggle CDP button in VSCodium`);
        }
        throw err;
      }
      const viewId = selectElectronViewTarget(tabs, sessionName);
      tabRegistry.set(sessionName, viewId);
      persistTabRegistry();
      return viewId;
    }

    const existingId = tabRegistry.get(sessionName);
    if (!existingId) {
      return await createOrReplaceTab(sessionName, port);
    }

    // Verify the tab still exists in Chrome
    let tabs: any[];
    try {
      tabs = await CDP.List({ host: '127.0.0.1', port });
    } catch (err: any) {
      if (err?.code === 'ECONNREFUSED') {
        throw new Error(`Chrome not reachable on port ${port} — toggle CDP button in VSCodium`);
      }
      throw err;
    }

    const stillExists = tabs.some((t: any) => t.id === existingId);
    if (!stillExists) {
      tabRegistry.delete(sessionName);
      persistTabRegistry();
      throw new Error(`Browser tab for session "${sessionName}" no longer exists — create a new one`);
    }

    await CDP.Activate({ id: existingId, host: '127.0.0.1', port });
    return existingId;
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
