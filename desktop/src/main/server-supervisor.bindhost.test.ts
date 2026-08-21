/**
 * MERMAID_BIND_HOST must reach the sidecar from config.json.
 *
 * The server binds 127.0.0.1 unless MERMAID_BIND_HOST says otherwise, so a phone on
 * the tailnet cannot reach it and GET /api/pair reports "bound to loopback". A
 * Dock-/login-launched sidecar starts with a clean environment, so the ONLY durable
 * way to set the bind host is the config.json injection list — `launchctl setenv` is
 * unreliable for app-spawned children. If MERMAID_BIND_HOST silently drops off that
 * list the phone stops connecting with no error anywhere.
 */
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveFlagsEnv } from './server-supervisor';

function withConfig(body: Record<string, unknown>, run: (configPath: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'collab-bindhost-'));
  const configPath = path.join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(body));
  try {
    run(configPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('sidecar bind host injection', () => {
  test('MERMAID_BIND_HOST in config.json is injected into the sidecar env', () => {
    withConfig({ MERMAID_BIND_HOST: '0.0.0.0' }, (configPath) => {
      const env = resolveFlagsEnv({ configPath, currentEnv: {} });
      expect(env.MERMAID_BIND_HOST).toBe('0.0.0.0');
    });
  });

  test('an explicit env value wins over config.json', () => {
    withConfig({ MERMAID_BIND_HOST: '0.0.0.0' }, (configPath) => {
      const env = resolveFlagsEnv({ configPath, currentEnv: { MERMAID_BIND_HOST: '127.0.0.1' } });
      expect(env.MERMAID_BIND_HOST).toBeUndefined();
    });
  });

  test('a config.json without the key injects nothing for it', () => {
    withConfig({ MERMAID_POOL_BACKEND: 2 }, (configPath) => {
      const env = resolveFlagsEnv({ configPath, currentEnv: {} });
      expect(env.MERMAID_BIND_HOST).toBeUndefined();
      expect(env.MERMAID_POOL_BACKEND).toBe('2');
    });
  });
});
