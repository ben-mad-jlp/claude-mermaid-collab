import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { getConfiguredPort } from './services/config-file.ts';
import { deriveCdpPort } from './services/project-registry.js';

// Get the directory where this module lives (src/)
// Go up one level to reach the project root where public/ is located
// Handle both Bun (import.meta.dir) and Node.js (import.meta.url) environments.
//
// MERMAID_RESOURCES_PATH override: in a packaged app the server runs as a
// `bun build --compile` binary whose import.meta.dir points at Bun's virtual
// filesystem (/$bunfs/...), so ui/dist & public can't be found relative to it.
// The Electron main process sets MERMAID_RESOURCES_PATH=process.resourcesPath
// (where extraResources bundles ui/dist + public), and we resolve from there.
const PROJECT_ROOT = process.env.MERMAID_RESOURCES_PATH ?? dirname(
  typeof (import.meta as any).dir !== 'undefined'
    ? (import.meta as any).dir
    : dirname(fileURLToPath(import.meta.url))
);

/**
 * Validates and parses the PORT environment variable.
 * @returns Valid port number between 1-65535
 * @throws {Error} If PORT is not a valid number or out of range
 */
function validatePort(): number {
  return getConfiguredPort();
}

/**
 * Application configuration loaded from environment variables with sensible defaults.
 *
 * @property {number} PORT - Server port number (1-65535). Default: 9002. Set via PORT env var.
 * @property {string} HOST - Server bind address. Default: '127.0.0.1' (loopback, safe by default). Set via MERMAID_BIND_HOST (preferred) or HOST env var; use '0.0.0.0' to share on the LAN.
 * @property {string} PUBLIC_DIR - Directory path for static files.
 * @property {number} MAX_FILE_SIZE - Maximum allowed file size in bytes. Default: 1048576 (1MB).
 * @property {number} THUMBNAIL_CACHE_SIZE - Maximum number of thumbnails to cache. Default: 100.
 * @property {number} UNDO_HISTORY_SIZE - Maximum number of undo operations to retain. Default: 50.
 * @property {number} WS_RECONNECT_MAX_DELAY - Maximum WebSocket reconnection delay in milliseconds. Default: 30000 (30 seconds).
 */
export const config = {
  PORT: validatePort(),
  HOST: process.env.MERMAID_BIND_HOST ?? process.env.HOST ?? '127.0.0.1',
  PUBLIC_DIR: join(PROJECT_ROOT, 'public'),
  MAX_FILE_SIZE: 1048576, // 1MB
  MAX_IMAGE_SIZE: 50 * 1024 * 1024, // 50 MB
  // Visual-media whitelist for the image/media artifact path: still images +
  // animated (gif/webp) + video + 3D models. All ride the same upload/store/index
  // path and are distinguished at render time by MIME prefix (image/ → <img>,
  // video/ → <video>, model/ → the three.js ModelViewer).
  ALLOWED_IMAGE_MIME_TYPES: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',
    'image/avif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'model/gltf-binary',  // glb
    'model/gltf+json',    // gltf
    'model/stl',          // stl
    'model/obj',          // obj
    'model/ply',          // ply
  ] as const,
  THUMBNAIL_CACHE_SIZE: 100,
  UNDO_HISTORY_SIZE: 50,
  WS_RECONNECT_MAX_DELAY: 30000,
  UI_DIST_DIR: join(PROJECT_ROOT, 'ui', 'dist'),
} as const;

/**
 * Requested server port. Unlike {@link config.PORT}, this allows the literal
 * value `0` to request an OS-assigned ephemeral port. The actual bound port
 * should be read from `server.port` after `Bun.serve()` returns.
 */
export const PORT_REQUEST = (process.env.PORT ?? '9002') === '0'
  ? 0
  : getConfiguredPort();

/**
 * Project root advertised by this server instance for instance discovery.
 * Defaults to the current working directory.
 */
export const MERMAID_PROJECT = process.env.MERMAID_PROJECT ?? process.cwd();

/**
 * Session name advertised by this server instance for instance discovery.
 * Defaults to `'scratch'`.
 */
export const MERMAID_SESSION = process.env.MERMAID_SESSION ?? 'scratch';

/**
 * Absolute path to the watched drop directory for [DOCSEND] inbox import (doc-dropbox.ts).
 * Absent → watcher is OFF (single-user deployments stay byte-identical). The Linux
 * cross-user deployment sets this to /var/lib/mermaid-collab/inbox/<user> — the path
 * is config, never hardcoded in src/.
 */
export const MERMAID_DOC_DROP_DIR = process.env.MERMAID_DOC_DROP_DIR ?? '';

/**
 * Session name new documents are imported into when MERMAID_DOC_DROP_DIR is set.
 * Defaults to this process's own MERMAID_SESSION (the project's default/most-recent
 * session for this server instance).
 */
export const MERMAID_DOC_DROP_SESSION = process.env.MERMAID_DOC_DROP_SESSION ?? MERMAID_SESSION;

/**
 * Whether the per-project Coordinator daemon auto-starts (and self-respawns) on
 * app launch for the local home project. Safe by design: the daemon only claims
 * todos already in `ready` (set only by the Planner post-approval), so an empty
 * ready-queue idles. Set `MERMAID_AUTO_START_COORDINATOR=0` to disable.
 */
export const MERMAID_AUTO_START_COORDINATOR =
  (process.env.MERMAID_AUTO_START_COORDINATOR ?? '1') !== '0';

/**
 * Project the global supervisor session lives in. MUST be a trusted directory.
 * Defaults to a dedicated, always-writable workspace at
 * `~/.mermaid-collab/supervisor` — not MERMAID_PROJECT, which in the packaged
 * desktop app is the read-only app bundle (Contents/Resources). The directory
 * is created on first use so launchAndBind (which requires the cwd to exist)
 * can spawn the supervisor there.
 */
export const SUPERVISOR_PROJECT =
  process.env.MERMAID_SUPERVISOR_PROJECT ?? join(homedir(), '.mermaid-collab', 'supervisor');
try {
  mkdirSync(SUPERVISOR_PROJECT, { recursive: true });
} catch {
  /* best-effort; launch will surface a clear error if the dir is unusable */
}

/** Session name reserved for the global supervisor. Defaults to 'supervisor'. */
export const SUPERVISOR_SESSION = process.env.MERMAID_SUPERVISOR_SESSION ?? 'supervisor';

/**
 * CDP (Chrome DevTools Protocol) port the browser tools connect to.
 * Defaults to a deterministic port derived from MERMAID_PROJECT (see
 * deriveCdpPort in project-registry.ts) so two same-user instances for
 * different projects land on different default ports without colliding.
 * Settable via the CDP_PORT env var so the Electron-spawned sidecar can
 * point at the app's own --remote-debugging-port. The server-owned Chrome
 * (streamed-panel / owned-chrome) is spawned with this same --remote-debugging-port.
 */
export const CDP_PORT = (() => {
  const envVal = process.env.CDP_PORT;
  if (envVal !== undefined) {
    const v = Number(envVal);
    if (!Number.isNaN(v)) return v;
  }
  return deriveCdpPort(MERMAID_PROJECT);
})();

/**
 * Optional bearer token required for authenticated HTTP/WS endpoints.
 * Empty (the default) disables token enforcement — today's open-localhost
 * behavior. Set MERMAID_AUTH_TOKEN when binding beyond loopback so remote
 * clients must present `Authorization: Bearer <token>`.
 */
export const MERMAID_AUTH_TOKEN = process.env.MERMAID_AUTH_TOKEN ?? '';

/**
 * How the browser_* tools obtain a Chrome:
 * - 'streamed-panel' (default) — the server spawns + owns a headless Chrome on
 *   CDP_PORT and a ScreencastService streams JPEG frames per session to the UI.
 * - 'owned-chrome'  — the server spawns + owns a Chrome on this machine, no streaming.
 * - 'electron-view' — drive the Electron app's embedded WebContentsView (set by the app supervisor).
 */
export const MC_BROWSER_TARGET = process.env.MC_BROWSER_TARGET || 'streamed-panel';

/** Explicit Chrome/Chromium binary path (overrides auto-discovery; needed on headless boxes). */
export const MERMAID_CHROME_PATH = process.env.MERMAID_CHROME_PATH ?? '';

/** Force headless Chrome. Default: headless when no display is detected. */
export const MERMAID_BROWSER_HEADLESS = process.env.MERMAID_BROWSER_HEADLESS === '1'
  || process.env.MERMAID_BROWSER_HEADLESS === 'true';

/** Idle self-shutdown: exit after this many ms with zero WS connections. Default 600000 (10 min); 0 disables.
 *  DESKTOP EXCEPTION: under the Electron supervisor (MC_DESKTOP_CONTROL_URL set) the default is 0 —
 *  the desktop sidecar is the mission-running daemon and must keep working with no UI connected.
 *  The 10-min default exists for stray plugin-hook source servers, and it silently killed the
 *  desktop daemon twice on 2026-07-23 (clean exits at exactly ~605s uptime, no respawn: the
 *  supervisor treats code-0 exits as intentional). An explicit env value still wins in both modes. */
export const MERMAID_IDLE_SHUTDOWN_MS = (() => {
  const fallback = process.env.MC_DESKTOP_CONTROL_URL ? '0' : '600000';
  const v = Number(process.env.MERMAID_IDLE_SHUTDOWN_MS ?? fallback);
  return Number.isNaN(v) ? Number(fallback) : v;
})();

/** Screencast JPEG quality (0-100) for streamed-panel mode. Default 60. */
export const MC_SCREENCAST_QUALITY = (() => {
  const v = Number(process.env.MC_SCREENCAST_QUALITY ?? '60');
  return Number.isNaN(v) ? 60 : v;
})();

/** Screencast max frame width (px). Default 1280. */
export const MC_SCREENCAST_MAX_WIDTH = (() => {
  const v = Number(process.env.MC_SCREENCAST_MAX_WIDTH ?? '1280');
  return Number.isNaN(v) ? 1280 : v;
})();

/** Screencast max frame height (px). Default 800. */
export const MC_SCREENCAST_MAX_HEIGHT = (() => {
  const v = Number(process.env.MC_SCREENCAST_MAX_HEIGHT ?? '800');
  return Number.isNaN(v) ? 800 : v;
})();

/** Send every Nth frame (CDP everyNthFrame). Default 1 (every frame). */
export const MC_SCREENCAST_EVERY_NTH_FRAME = (() => {
  const v = Number(process.env.MC_SCREENCAST_EVERY_NTH_FRAME ?? '1');
  return Number.isNaN(v) || v < 1 ? 1 : v;
})();
