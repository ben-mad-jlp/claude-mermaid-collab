/**
 * The node permission mode resolves from config, defaults SAFE, and never returns a
 * hang-prone mode. This is the reversible switch that moves leaf nodes off bypassPermissions.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveNodePermissionMode, NODE_PERMISSION_MODE_KEY } from '../node-permission-mode';
import { _resetConfigCache } from '../config-file';

const KEY = NODE_PERMISSION_MODE_KEY;

// ISOLATE the config.json layer: getConfig reads env → MERMAID_CONFIG_PATH file → fallback.
// Without this the test reads the DEVELOPER's live ~/.mermaid-collab/config.json (which now
// carries MERMAID_NODE_PERMISSION_MODE after the dontAsk rollout), so "unset → bypass" went red
// on this machine. Point the config file at an empty temp dir so only env + fallback decide.
let cfgDir: string;
let prevCfgPath: string | undefined;

beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), 'node-perm-mode-'));
  prevCfgPath = process.env.MERMAID_CONFIG_PATH;
  process.env.MERMAID_CONFIG_PATH = join(cfgDir, 'config.json'); // nonexistent → {}
  _resetConfigCache();
});

afterEach(() => {
  delete process.env[KEY];
  if (prevCfgPath === undefined) delete process.env.MERMAID_CONFIG_PATH;
  else process.env.MERMAID_CONFIG_PATH = prevCfgPath;
  _resetConfigCache();
  rmSync(cfgDir, { recursive: true, force: true });
});

describe('resolveNodePermissionMode', () => {
  test('defaults to bypassPermissions when unset (behavior unchanged)', () => {
    delete process.env[KEY];
    expect(resolveNodePermissionMode()).toBe('bypassPermissions');
  });

  test("config 'dontAsk' selects the spec'd sandbox", () => {
    process.env[KEY] = 'dontAsk';
    expect(resolveNodePermissionMode()).toBe('dontAsk');
  });

  test("config 'bypassPermissions' is honored explicitly", () => {
    process.env[KEY] = 'bypassPermissions';
    expect(resolveNodePermissionMode()).toBe('bypassPermissions');
  });

  test('an unsupported value falls back to bypassPermissions — never a hang-prone mode', () => {
    // manual/acceptEdits/plan PROMPT on an un-approved call and would hang a tty-less child.
    for (const bad of ['manual', 'acceptEdits', 'plan', 'auto', 'garbage', '']) {
      process.env[KEY] = bad;
      expect(resolveNodePermissionMode()).toBe('bypassPermissions');
    }
  });
});
