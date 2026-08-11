/**
 * The explore node's allowlist must be the CONSTANT, not a literal copy of it.
 *
 * MEASURED 2026-08-11: `EXPLORE_NODE_ALLOWED_TOOLS` was defined, exported, and re-exported
 * through leaf-executor — and read by nothing. `NODE_PROFILE.explore` carried a hardcoded
 * 'Read Grep Glob Bash', so the explore node could not call `file_finding` and had no way to
 * write the typed Finding that the finding store, failureIdentity dedup and quarantine runner
 * are all built around. The feature shipped half-wired for four days, and the original comment
 * says why: the wiring was deferred to another epic that never landed.
 *
 * So these tests assert IDENTITY (profile === constant), not content equality. A test that
 * merely checked "the profile mentions file_finding" would pass again the moment someone
 * re-inlines a literal that happens to contain it, which is the exact regression.
 */
import { describe, it, expect } from 'bun:test';
import { NODE_PROFILE, EXPLORE_NODE_ALLOWED_TOOLS } from '../leaf-node-profile';

const tools = (s: string) => s.split(/\s+/).filter(Boolean);

describe('the explore allowlist constant is actually wired', () => {
  it('NODE_PROFILE.explore uses the constant itself', () => {
    // Identity, not equality: this is what a re-inlined literal would break.
    expect(NODE_PROFILE.explore.allowedTools).toBe(EXPLORE_NODE_ALLOWED_TOOLS);
  });

  it('grants file_finding — without it the node cannot record what it found', () => {
    expect(tools(NODE_PROFILE.explore.allowedTools)).toContain('mcp__mermaid__file_finding');
  });

  it('grants the desktop verbs, so it can audit a RUNNING ui rather than read React source', () => {
    const granted = tools(NODE_PROFILE.explore.allowedTools);
    for (const verb of ['snapshot', 'screenshot', 'list_targets', 'wait_for', 'navigate', 'click', 'fill', 'eval']) {
      expect(granted).toContain(`mcp__mermaid__desktop_${verb}`);
    }
  });

  it('keeps the code-reading tools — a finding still has to cite source', () => {
    const granted = tools(NODE_PROFILE.explore.allowedTools);
    for (const t of ['Read', 'Grep', 'Glob', 'Bash']) expect(granted).toContain(t);
  });

  it('does NOT grant Edit or Write — explore investigates, it does not implement', () => {
    // An explore leaf produces a Finding, not a diff. Write access would let it "fix" what it
    // found in a worktree nothing reviews, and the gate never runs on the explore path.
    const granted = tools(NODE_PROFILE.explore.allowedTools);
    expect(granted).not.toContain('Edit');
    expect(granted).not.toContain('Write');
  });

  it('names every tool exactly once', () => {
    const granted = tools(EXPLORE_NODE_ALLOWED_TOOLS);
    expect(new Set(granted).size).toBe(granted.length);
  });
});
