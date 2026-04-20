import { describe, it, expect } from 'bun:test';
import { PermissionBridge } from '../permission-bridge';
import type { AgentEvent, InteractionMode, PermissionMode } from '../contracts';
import type { PermissionRequest } from '../permission-socket';

/**
 * Unit coverage for the InteractionMode decision path in PermissionBridge.
 *
 * These tests bypass the legacy PermissionMode accessor by providing the
 * `getInteractionMode` dep directly, asserting that each of the three
 * interaction modes (ask / accept-edits / plan) route Edit, Bash, and Read
 * tool requests correctly without regressing the legacy API.
 */

function mkRequest(toolName: string): PermissionRequest {
  return {
    hookEventName: 'PreToolUse',
    toolName,
    toolInput: {},
  };
}

function mkBridge(interaction: InteractionMode, legacyMode: PermissionMode = 'supervised') {
  const events: AgentEvent[] = [];
  const bridge = new PermissionBridge({
    broadcast: (e) => events.push(e),
    getMode: () => legacyMode,
    getInteractionMode: () => interaction,
    persistDir: '/tmp/pb-mode-test',
    hookBinPath: '/tmp/pb-hook',
    timeoutMs: 50,
  });
  return { bridge, events };
}

describe('PermissionBridge InteractionMode routing', () => {
  describe("mode: 'plan'", () => {
    it('auto-denies Edit', async () => {
      const { bridge } = mkBridge('plan');
      const res = await bridge.onPermissionRequest('s1', mkRequest('Edit'));
      expect(res.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(res.hookSpecificOutput.permissionDecisionReason).toContain('plan');
    });

    it('auto-denies Bash', async () => {
      const { bridge } = mkBridge('plan');
      const res = await bridge.onPermissionRequest('s1', mkRequest('Bash'));
      expect(res.hookSpecificOutput.permissionDecision).toBe('deny');
    });

    it('auto-allows Read (read-class)', async () => {
      const { bridge } = mkBridge('plan');
      const res = await bridge.onPermissionRequest('s1', mkRequest('Read'));
      expect(res.hookSpecificOutput.permissionDecision).toBe('allow');
    });
  });

  describe("mode: 'accept-edits'", () => {
    it('auto-allows Edit', async () => {
      const { bridge } = mkBridge('accept-edits');
      const res = await bridge.onPermissionRequest('s1', mkRequest('Edit'));
      expect(res.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(res.hookSpecificOutput.permissionDecisionReason).toContain('accept-edits');
    });

    it('prompts (timeout=deny) for Bash', async () => {
      const { bridge, events } = mkBridge('accept-edits');
      const p = bridge.onPermissionRequest('s1', mkRequest('Bash'));
      // 50ms timeout -> deny
      const res = await p;
      expect(res.hookSpecificOutput.permissionDecision).toBe('deny');
      // A permission_requested should have been broadcast (user was prompted).
      expect(events.some((e) => e.kind === 'permission_requested')).toBe(true);
    });

    it('prompts for Read (non-edit, non-bypass)', async () => {
      const { bridge, events } = mkBridge('accept-edits');
      await bridge.onPermissionRequest('s1', mkRequest('Read'));
      expect(events.some((e) => e.kind === 'permission_requested')).toBe(true);
    });
  });

  describe("mode: 'ask'", () => {
    it('prompts for Edit', async () => {
      const { bridge, events } = mkBridge('ask');
      await bridge.onPermissionRequest('s1', mkRequest('Edit'));
      expect(events.some((e) => e.kind === 'permission_requested')).toBe(true);
    });

    it('prompts for Bash', async () => {
      const { bridge, events } = mkBridge('ask');
      await bridge.onPermissionRequest('s1', mkRequest('Bash'));
      expect(events.some((e) => e.kind === 'permission_requested')).toBe(true);
    });

    it('prompts for Read', async () => {
      const { bridge, events } = mkBridge('ask');
      await bridge.onPermissionRequest('s1', mkRequest('Read'));
      expect(events.some((e) => e.kind === 'permission_requested')).toBe(true);
    });
  });

  describe('legacy PermissionMode path (no getInteractionMode)', () => {
    it("routes legacy 'plan' via splitPermissionMode → denies Edit", async () => {
      const events: AgentEvent[] = [];
      const bridge = new PermissionBridge({
        broadcast: (e) => events.push(e),
        getMode: () => 'plan' as PermissionMode,
        persistDir: '/tmp/pb-legacy',
        hookBinPath: '/tmp/pb-hook',
        timeoutMs: 50,
      });
      const res = await bridge.onPermissionRequest('s1', mkRequest('Edit'));
      expect(res.hookSpecificOutput.permissionDecision).toBe('deny');
    });

    it("routes legacy 'accept-edits' → allows Write", async () => {
      const events: AgentEvent[] = [];
      const bridge = new PermissionBridge({
        broadcast: (e) => events.push(e),
        getMode: () => 'accept-edits' as PermissionMode,
        persistDir: '/tmp/pb-legacy',
        hookBinPath: '/tmp/pb-hook',
        timeoutMs: 50,
      });
      const res = await bridge.onPermissionRequest('s1', mkRequest('Write'));
      expect(res.hookSpecificOutput.permissionDecision).toBe('allow');
    });

    it("routes legacy 'bypass' → allows Bash", async () => {
      const events: AgentEvent[] = [];
      const bridge = new PermissionBridge({
        broadcast: (e) => events.push(e),
        getMode: () => 'bypass' as PermissionMode,
        persistDir: '/tmp/pb-legacy',
        hookBinPath: '/tmp/pb-hook',
        timeoutMs: 50,
      });
      const res = await bridge.onPermissionRequest('s1', mkRequest('Bash'));
      expect(res.hookSpecificOutput.permissionDecision).toBe('allow');
    });
  });
});
