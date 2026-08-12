// Desktop (Electron) MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the DESKTOP tool group: Electron bridge connectivity, screenshot capture with
// optional session save, and desktop driver operations (navigate/eval/click/fill/wait_for/
// snapshot/list_targets). Assembled from exact byte ranges of setup.ts — behavior is
// identical, a pure move.
import { mkdir, writeFile } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import { notifyToolListChanged } from './tool-registry-notifier.js';

// --- Desktop (Electron) MCP tools ---
// electron-agent-bridge is an OPTIONAL dependency: it drives the Electron
// desktop app over CDP and is only meaningful where that app runs. On headless
// / remote servers the package may be absent, so we load it lazily and degrade
// gracefully (desktop_* tools simply disappear) rather than crashing on boot.
type ElectronDriverT = import('electron-agent-bridge/driver').ElectronDriver;
let _bridge: { ElectronDriver: any; createDesktopTools: any } | null = null;
let _desktopDefs: any[] = [];
let _desktopHandlers: Record<string, (args: any) => Promise<any>> = {};

const desktopSelectTarget = (t: any) => t.type === 'page' && /Mermaid Collab/i.test(t.title || '');
let _dd: ElectronDriverT | null = null;

/**
 * Idempotent lazy initialization of the desktop bridge.
 * On first call (or after a reset), attempts to load the electron-agent-bridge
 * optional dependency. On success, populates _desktopDefs and _desktopHandlers,
 * and notifies registered servers that the tool list has changed.
 * On failure, logs a warning and returns false; a later call will retry.
 *
 * Note: If _bridge is set but _desktopDefs is empty (e.g., after __setDesktopBridgeForTest),
 * this will re-initialize to allow test mocks to take effect.
 */
export async function ensureDesktopBridge(): Promise<boolean> {
  // Already fully initialized — return immediately without re-importing or notifying
  if (_bridge !== null && _desktopDefs.length > 0) return true;

  try {
    // If _bridge is not set, load it; if it is set (e.g., by test), use it as-is
    if (!_bridge) {
      const [driverMod, toolsMod] = await Promise.all([
        import('electron-agent-bridge/driver'),
        import('electron-agent-bridge/mcp-tools'),
      ]);
      _bridge = { ElectronDriver: driverMod.ElectronDriver, createDesktopTools: toolsMod.createDesktopTools };
    }

    // Build the tool defs and handlers
    const { defs, handlers } = _bridge.createDesktopTools(getDesktopDriver);
    // Filter out the old desktop_screenshot def and use our custom one
    _desktopDefs = [...defs.filter((d: any) => d.name !== 'desktop_screenshot'), desktopScreenshotDef];
    _desktopHandlers = handlers;

    // Notify all registered servers that the tool list has changed
    notifyToolListChanged('desktop-bridge');

    return true;
  } catch (e) {
    console.warn('[mcp] electron-agent-bridge unavailable — desktop_* tools disabled:', (e as Error).message);
    return false;
  }
}

async function getDesktopDriver(): Promise<ElectronDriverT> {
  // Attempt to ensure the bridge is initialized before using it
  await ensureDesktopBridge();

  if (!_bridge) throw new Error('Desktop bridge not installed (electron-agent-bridge missing on this host)');
  if (!_dd) {
    try {
      _dd = await _bridge.ElectronDriver.fromDiscovery({ appName: 'mermaid-collab', selectTarget: desktopSelectTarget });
    } catch (e) {
      _dd = null;
      throw new Error('Desktop app not reachable (no discovery file / not running): ' + (e as Error).message);
    }
  }
  return _dd!;
}

function resetDesktopDriver(): void { _dd = null; }

function isDesktopConnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|WebSocket|not reachable|connect/i.test(msg);
}

async function withDesktopRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (!isDesktopConnError(e)) throw e;
    resetDesktopDriver();
    return await op();
  }
}

const desktopScreenshotDef = {
  name: 'desktop_screenshot',
  description: 'Screenshot the desktop app renderer. If project+session given, saves under that session images dir and returns the path; otherwise returns base64.',
  inputSchema: { type: 'object' as const, properties: { format: { type: 'string', enum: ['png', 'jpeg'] }, project: { type: 'string' }, session: { type: 'string' } } },
};

/**
 * Get the current desktop tool definitions.
 * On a host without electron-agent-bridge, returns an empty array.
 */
export function getDesktopToolDefs(): any[] {
  return _desktopDefs;
}

/**
 * Get the current desktop tool handlers.
 * On a host without electron-agent-bridge, returns an empty object.
 */
export function getDesktopHandlers(): Record<string, (args: any) => Promise<any>> {
  return _desktopHandlers;
}

/**
 * Test-only seam: replace the bridge with a mock or null to control behavior.
 * Resets the defs and handlers arrays so a fresh ensureDesktopBridge() call
 * will re-initialize from the new bridge.
 */
export function __setDesktopBridgeForTest(bridge: { ElectronDriver: any; createDesktopTools: any } | null): void {
  _bridge = bridge;
  _desktopDefs = [];
  _desktopHandlers = {};
}

export async function handleDesktopTool(name: string, args: any): Promise<string | null> {
  // Attempt to ensure the bridge is initialized before checking handlers
  await ensureDesktopBridge();

  if (name === 'desktop_screenshot') {
    const a = (args ?? {}) as { project?: string; session?: string; format?: 'png' | 'jpeg' };
    const { base64 } = await withDesktopRetry(async () => {
      const d = await getDesktopDriver();
      return d.screenshot({ format: a.format });
    });
    if (a.project && a.session) {
      const imagesDir = pathJoin(a.project, '.collab', 'sessions', a.session, 'images');
      await mkdir(imagesDir, { recursive: true });
      const ext = a.format === 'jpeg' ? 'jpg' : 'png';
      const filePath = pathJoin(imagesDir, `desktop-screenshot-${Date.now()}.${ext}`);
      await writeFile(filePath, Buffer.from(base64, 'base64'));
      return JSON.stringify({ saved: filePath }, null, 2);
    }
    return JSON.stringify({ base64 });
  }

  const handlers = getDesktopHandlers();
  if (name in handlers) {
    const handler = handlers[name];
    return await withDesktopRetry(() => handler(args ?? {}));
  }

  return null;
}
