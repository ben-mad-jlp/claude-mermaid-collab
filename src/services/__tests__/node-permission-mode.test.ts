/**
 * The node permission mode resolves from config, defaults SAFE, and never returns a
 * hang-prone mode. This is the reversible switch that moves leaf nodes off bypassPermissions.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { resolveNodePermissionMode, NODE_PERMISSION_MODE_KEY } from '../node-permission-mode';

const KEY = NODE_PERMISSION_MODE_KEY;

afterEach(() => {
  delete process.env[KEY];
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
