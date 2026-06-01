import { describe, it, expect } from 'bun:test';
import { resolveProfile, AGENT_PROFILES, DEFAULT_PROFILE_TYPE } from '../../config/agent-profiles';

describe('agent-profiles registry', () => {
  it('resolves a known type to its profile', () => {
    expect(resolveProfile('frontend')).toBe(AGENT_PROFILES.frontend);
    expect(resolveProfile('backend')).toBe(AGENT_PROFILES.backend);
  });

  it('falls back to default for unknown/missing type', () => {
    expect(resolveProfile(undefined)).toBe(AGENT_PROFILES[DEFAULT_PROFILE_TYPE]);
    expect(resolveProfile(null)).toBe(AGENT_PROFILES[DEFAULT_PROFILE_TYPE]);
    expect(resolveProfile('nonsense')).toBe(AGENT_PROFILES[DEFAULT_PROFILE_TYPE]);
  });

  it('every profile grants the mermaid MCP + can do work, with a runtime mode', () => {
    for (const [type, p] of Object.entries(AGENT_PROFILES)) {
      expect(p.allowedTools, type).toContain('mcp__plugin_mermaid-collab_mermaid');
      expect(p.allowedTools, type).toContain('Edit');
      expect(p.runtimeMode, type).toBeDefined();
    }
  });
});
