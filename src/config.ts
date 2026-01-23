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
  const portValue = process.env.PORT || '3737';
  const port = parseInt(portValue, 10);

  if (isNaN(port)) {
    throw new Error(`Invalid PORT value: "${portValue}" is not a valid number`);
  }

  if (port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${port} is out of valid range (1-65535)`);
  }

  return port;
}

/**
 * Application configuration loaded from environment variables with sensible defaults.
 *
 * @property {number} PORT - Server port number (1-65535). Default: 3737. Set via PORT env var.
 * @property {string} HOST - Server host address. Default: '0.0.0.0'. Set via HOST env var.
 * @property {string} PUBLIC_DIR - Directory path for static files.
 * @property {number} MAX_FILE_SIZE - Maximum allowed file size in bytes. Default: 1048576 (1MB).
 * @property {number} THUMBNAIL_CACHE_SIZE - Maximum number of thumbnails to cache. Default: 100.
 * @property {number} UNDO_HISTORY_SIZE - Maximum number of undo operations to retain. Default: 50.
 * @property {number} WS_RECONNECT_MAX_DELAY - Maximum WebSocket reconnection delay in milliseconds. Default: 30000 (30 seconds).
 */
export const config = {
  PORT: validatePort(),
  HOST: process.env.HOST || '0.0.0.0',
  PUBLIC_DIR: join(PROJECT_ROOT, 'public'),
  MAX_FILE_SIZE: 1048576, // 1MB
  THUMBNAIL_CACHE_SIZE: 100,
  UNDO_HISTORY_SIZE: 50,
  WS_RECONNECT_MAX_DELAY: 30000,
  UI_DIST_DIR: join(PROJECT_ROOT, 'ui', 'dist'),
} as const;
