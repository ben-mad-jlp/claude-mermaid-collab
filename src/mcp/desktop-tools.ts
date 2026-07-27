// Desktop (Electron) MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the DESKTOP tool group: Electron bridge connectivity, screenshot capture with
// optional session save, and desktop driver operations (navigate/eval/click/fill/wait_for/
// snapshot/list_targets). Assembled from exact byte ranges of setup.ts — behavior is
// identical, a pure move.
import { mkdir, writeFile } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';

// --- Desktop (Electron) MCP tools ---
// electron-agent-bridge is an OPTIONAL dependency: it drives the Electron
// desktop app over CDP and is only meaningful where that app runs. On headless
// / remote servers the package may be absent, so we load it lazily and degrade
// gracefully (desktop_* tools simply disappear) rather than crashing on boot.
type ElectronDriverT = import('electron-agent-bridge/driver').ElectronDriver;
let _bridge: { ElectronDriver: any; createDesktopTools: any } | null = null;
try {
  const [driverMod, toolsMod] = await Promise.all([
    import('electron-agent-bridge/driver'),
    import('electron-agent-bridge/mcp-tools'),
  ]);
  _bridge = { ElectronDriver: driverMod.ElectronDriver, createDesktopTools: toolsMod.createDesktopTools };
} catch (e) {
  console.warn('[mcp] electron-agent-bridge unavailable — desktop_* tools disabled:', (e as Error).message);
}

const desktopSelectTarget = (t: any) => t.type === 'page' && /Mermaid Collab/i.test(t.title || '');
let _dd: ElectronDriverT | null = null;
async function getDesktopDriver(): Promise<ElectronDriverT> {
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

const { defs: desktopDefs, handlers: desktopHandlers }: { defs: any[]; handlers: Record<string, (args: any) => Promise<any>> } =
  _bridge ? _bridge.createDesktopTools(getDesktopDriver) : { defs: [], handlers: {} };
const desktopDefsForList = desktopDefs.filter((d) => d.name !== 'desktop_screenshot');
const desktopScreenshotDef = {
  name: 'desktop_screenshot',
  description: 'Screenshot the desktop app renderer. If project+session given, saves under that session images dir and returns the path; otherwise returns base64.',
  inputSchema: { type: 'object' as const, properties: { format: { type: 'string', enum: ['png', 'jpeg'] }, project: { type: 'string' }, session: { type: 'string' } } },
};
const DESKTOP_TOOL_DEFS = _bridge ? [...desktopDefsForList, desktopScreenshotDef] : [];

export { DESKTOP_TOOL_DEFS };

export async function handleDesktopTool(name: string, args: any): Promise<string | null> {
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

  if (name in desktopHandlers) {
    const handler = desktopHandlers[name];
    return await withDesktopRetry(() => handler(args ?? {}));
  }

  return null;
}
