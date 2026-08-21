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
import { resolveFlagsEnv, ServerSupervisor } from './server-supervisor';

/** Build the child env the sidecar would actually be spawned with. */
function childEnvFor(opts: { host: string; bindHost?: string }): NodeJS.ProcessEnv {
  const sup = new ServerSupervisor({
    repoRoot: '/tmp/repo',
    project: '/tmp/repo',
    session: 'test',
    host: opts.host,
    bindHost: opts.bindHost,
  } as never);
  return (sup as unknown as { buildChildEnv(port: number): NodeJS.ProcessEnv }).buildChildEnv(9002);
}

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

/**
 * The config value is only half the story: buildChildEnv sets MERMAID_BIND_HOST
 * EXPLICITLY, after the config spread, so an explicit value silently wins over
 * anything config.json injected. That is how a config of 0.0.0.0 still produced a
 * sidecar bound to 127.0.0.1 (2026-08-21). The bind address must come from
 * `bindHost`, kept distinct from `host`, which health polls and the proxy dial.
 */
describe('sidecar child env bind address', () => {
  test('bindHost is what the sidecar binds to', () => {
    const env = childEnvFor({ host: '127.0.0.1', bindHost: '0.0.0.0' });
    expect(env.MERMAID_BIND_HOST).toBe('0.0.0.0');
    expect(env.HOST).toBe('0.0.0.0');
  });

  test('bindHost left unset falls back to the connect host', () => {
    const env = childEnvFor({ host: '127.0.0.1' });
    expect(env.MERMAID_BIND_HOST).toBe('127.0.0.1');
  });

  test('the connect host stays loopback even when the bind address is wide open', () => {
    const sup = new ServerSupervisor({
      repoRoot: '/tmp/repo', project: '/tmp/repo', session: 'test',
      host: '127.0.0.1', bindHost: '0.0.0.0',
    } as never);
    expect((sup as unknown as { opts: { host: string } }).opts.host).toBe('127.0.0.1');
  });
});
