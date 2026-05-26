import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory where this module lives (src/)
// Go up one level to reach the project root where public/ is located
// Handle both Bun (import.meta.dir) and Node.js (import.meta.url) environments
const PROJECT_ROOT = dirname(
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
  const portValue = process.env.PORT || '9002';
  const port = parseInt(portValue, 10);

  if (isNaN(port)) {
    throw new Error(`Invalid PORT value: "${portValue}" is not a valid number`);
  }

  if (port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${port} is out of valid range (0-65535)`);
  }

  return port;
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
  ALLOWED_IMAGE_MIME_TYPES: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',
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
  : Number.parseInt(process.env.PORT ?? '9002', 10);

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
 * CDP (Chrome DevTools Protocol) port the browser tools connect to.
 * Defaults to 9333. Settable via the CDP_PORT env var so the Electron-spawned
 * sidecar can point at the app's own --remote-debugging-port. Falls back to
 * 9333 if the env value is not a valid number.
 */
export const CDP_PORT = (() => {
  const v = Number(process.env.CDP_PORT ?? '9333');
  return Number.isNaN(v) ? 9333 : v;
})();

/**
 * Optional bearer token required for authenticated HTTP/WS endpoints.
 * Empty (the default) disables token enforcement — today's open-localhost
 * behavior. Set MERMAID_AUTH_TOKEN when binding beyond loopback so remote
 * clients must present `Authorization: Bearer <token>`.
 */
export const MERMAID_AUTH_TOKEN = process.env.MERMAID_AUTH_TOKEN ?? '';
