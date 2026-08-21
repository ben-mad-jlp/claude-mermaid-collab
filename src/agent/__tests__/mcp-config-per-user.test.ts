/**
 * The generated MCP config directory must be PER-USER.
 *
 * It was a fixed shared name under tmp, so on a multi-user box the first server to boot
 * created it under its own uid and every other user's server hit EACCES writing its own
 * config. A conductor node writes this file before it starts, so the node never launched,
 * no pass was recorded, and the mission sat with lastPassAt null. Observed 2026-08-21:
 * user alec's server (port 9205) owned <tmp>/mermaid-node-mcp-config at 0775 and user
 * ben's server (port 9002) could not create its file there.
 */
import { describe, it, expect } from 'bun:test';
import { statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpConfigDir, mcpConfigFor, nodeSettingsFile } from '../node-invoker.ts';
import { LEAF_SCRATCH_ROOT } from '../../services/leaf-scratch.ts';

describe('MCP config directory isolation', () => {
  it('is scoped by uid, not a shared constant', () => {
    expect(mcpConfigDir(1000)).not.toBe(join(tmpdir(), 'mermaid-node-mcp-config'));
    expect(mcpConfigDir(1000)).toContain('1000');
  });

  it('two users never resolve to the same directory', () => {
    expect(mcpConfigDir(1000)).not.toBe(mcpConfigDir(1001));
  });

  it('the default resolves under tmp for the current user', () => {
    expect(mcpConfigDir().startsWith(tmpdir())).toBe(true);
  });

  it('the written config lives in this user directory and is private', () => {
    const path = mcpConfigFor(65123);
    expect(path.startsWith(mcpConfigDir())).toBe(true);
    expect(existsSync(path)).toBe(true);
    // 0700: nobody else needs to read, let alone write, another user's node configs.
    expect(statSync(mcpConfigDir()).mode & 0o777).toBe(0o700);
    rmSync(path, { force: true });
  });

  it('the config still points at the port it was asked for', () => {
    const path = mcpConfigFor(65124);
    const body = JSON.parse(require('node:fs').readFileSync(path, 'utf8'));
    expect(body.mcpServers.mermaid.url).toBe('http://127.0.0.1:65124/mcp');
    rmSync(path, { force: true });
  });

  it('the node-settings directory is per-user too', () => {
    const p = nodeSettingsFile();
    // Null only when the confinement hook is absent; the path assertion is what matters.
    if (p) expect(p).toContain(`mermaid-node-settings-${process.getuid?.() ?? ''}`);
  });

  it('the leaf scratch root is per-user too', () => {
    expect(LEAF_SCRATCH_ROOT).not.toBe(join(tmpdir(), 'mermaid-leaf-scratch'));
    expect(LEAF_SCRATCH_ROOT).toContain(String(process.getuid?.() ?? ''));
  });
});
