import { join } from 'path';

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
 * This object is frozen at runtime to prevent accidental modification.
 *
 * @property {number} PORT - Server port number (1-65535). Default: 3737. Set via PORT env var.
 * @property {string} HOST - Server host address. Default: '0.0.0.0'. Set via HOST env var.
 * @property {string} STORAGE_DIR - Base directory for all storage. Default: '.'. Set via STORAGE_DIR env var.
 * @property {string} DIAGRAMS_FOLDER - Directory path for storing diagram files. Derived from STORAGE_DIR.
 * @property {string} DOCUMENTS_FOLDER - Directory path for storing document files. Derived from STORAGE_DIR.
 * @property {string} METADATA_FILE - Path to metadata.json file. Derived from STORAGE_DIR.
 * @property {number} MAX_FILE_SIZE - Maximum allowed file size in bytes. Default: 1048576 (1MB).
 * @property {number} THUMBNAIL_CACHE_SIZE - Maximum number of thumbnails to cache. Default: 100.
 * @property {number} UNDO_HISTORY_SIZE - Maximum number of undo operations to retain. Default: 50.
 * @property {number} WS_RECONNECT_MAX_DELAY - Maximum WebSocket reconnection delay in milliseconds. Default: 30000 (30 seconds).
 */
export const config = Object.freeze({
  PORT: validatePort(),
  HOST: process.env.HOST || '0.0.0.0',
  STORAGE_DIR: process.env.STORAGE_DIR || '.',
  get DIAGRAMS_FOLDER() { return join(this.STORAGE_DIR, 'diagrams') },
  get DOCUMENTS_FOLDER() { return join(this.STORAGE_DIR, 'documents') },
  get METADATA_FILE() { return join(this.STORAGE_DIR, 'metadata.json') },
  MAX_FILE_SIZE: 1048576, // 1MB
  THUMBNAIL_CACHE_SIZE: 100,
  UNDO_HISTORY_SIZE: 50,
  WS_RECONNECT_MAX_DELAY: 30000,
} as const);
