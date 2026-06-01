import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Minimal config/secrets read layer.
 * Precedence: process.env wins, then ~/.mermaid-collab/config.json, then fallback.
 * Reading the global config file from the server process means secrets (e.g.
 * XAI_API_KEY) reach the server regardless of how it was launched (GUI/Dock or
 * CLI) — fixing the case where a Dock-launched desktop sidecar has no env.
 * config.ts's frozen constants are intentionally NOT migrated here yet.
 */
function configPath(): string {
  return process.env.MERMAID_CONFIG_PATH ?? join(homedir(), '.mermaid-collab', 'config.json');
}

let cache: Record<string, unknown> | null = null;

function loadFile(): Record<string, unknown> {
  if (cache) return cache;
  try {
    const p = configPath();
    cache = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Precedence: non-empty process.env[key] → non-empty string in config.json → fallback. */
export function getConfig(key: string, fallback?: string): string | undefined {
  const env = process.env[key];
  if (env !== undefined && env !== '') return env;
  const fileVal = loadFile()[key];
  if (typeof fileVal === 'string' && fileVal !== '') return fileVal;
  return fallback;
}

/** Test helper: drop the cached file so the next getConfig re-reads. */
export function _resetConfigCache(): void { cache = null; }
