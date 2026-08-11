/**
 * Pins the set of NODE_PROFILE kinds whose STATIC allowlist carries an mcp__ tool.
 * buildSpec/buildVerifySpec's `mcpConfig` condition is written against exactly this
 * set ('report', 'driveexec') — a new mcp-granting kind added to NODE_PROFILE without
 * also updating those conditions would silently fall back to the cwd's checked-in
 * .mcp.json, so this test trips to force a reviewer to touch both.
 */
import { describe, it, expect } from 'bun:test';
import { NODE_PROFILE } from '../leaf-executor.ts';

describe('NODE_PROFILE mcp__ coverage', () => {
  it('every kind whose static allowlist grants an mcp__ tool is a known mcp-bearing kind', () => {
    // 'explore' joined 2026-08-11: file_finding (its output path) + the desktop_* CDP verbs so it
    // can audit a RUNNING UI. Widened consciously — see leaf-node-profile.ts's destructive-by-
    // design note; the blast radius is bounded by what the explore REQUEST points at.
    const knownMcpBearingKinds = ['report', 'driveexec', 'explore'];
    for (const kind of Object.keys(NODE_PROFILE)) {
      if (NODE_PROFILE[kind as keyof typeof NODE_PROFILE].allowedTools.includes('mcp__')) {
        expect(knownMcpBearingKinds).toContain(kind);
      }
    }
  });
});
