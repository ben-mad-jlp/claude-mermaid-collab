// Token-precedence tests for the remote-launch flow. The server is
// config-authoritative (config.json-first), so a launch must ADOPT the token the
// server already has rather than mint a fresh one that the server would reject
// ('diverged'). resolveLaunchToken encodes that precedence; these are hermetic
// (no SSH) since the function is pure.
import { describe, test, expect } from 'bun:test';
import { resolveLaunchToken, applyTokenToCommand } from '../remote-launch';

describe('resolveLaunchToken precedence', () => {
  test("adopts the server's existing config.json token over everything else", () => {
    const r = resolveLaunchToken({ configToken: 'CFG', callerToken: 'CALLER' });
    expect(r).toEqual({ token: 'CFG', source: 'config' });
  });

  test('falls back to the caller token when the server has none (fresh box)', () => {
    const r = resolveLaunchToken({ configToken: '', callerToken: 'CALLER' });
    expect(r).toEqual({ token: 'CALLER', source: 'caller' });
  });

  test('mints a fresh 48-hex token when neither is present', () => {
    const r = resolveLaunchToken({});
    expect(r.source).toBe('minted');
    expect(r.token).toMatch(/^[0-9a-f]{48}$/);
  });

  test('treats whitespace-only tokens as empty', () => {
    const r = resolveLaunchToken({ configToken: '   ', callerToken: ' CALLER ' });
    // config is blank → caller wins, trimmed.
    expect(r).toEqual({ token: 'CALLER', source: 'caller' });
  });

  test('config token wins even if a caller token is also blank-padded', () => {
    const r = resolveLaunchToken({ configToken: ' T1 ', callerToken: '' });
    expect(r).toEqual({ token: 'T1', source: 'config' });
  });
});

describe('applyTokenToCommand keeps the command auth-required', () => {
  test('prepends MERMAID_AUTH_TOKEN when the command lacks it', () => {
    expect(applyTokenToCommand('mermaid-collab start --port 9002', 'T1')).toBe(
      'MERMAID_AUTH_TOKEN=T1 mermaid-collab start --port 9002',
    );
  });

  test('leaves a command that already exports the token unchanged', () => {
    const cmd = 'MERMAID_AUTH_TOKEN=T1 MERMAID_BIND_HOST=0.0.0.0 mermaid-collab start --port 9002';
    expect(applyTokenToCommand(cmd, 'T2')).toBe(cmd);
  });
});
