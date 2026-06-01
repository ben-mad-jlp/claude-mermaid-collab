import { describe, it, expect } from 'bun:test';
import { resolveProfile, inferProfileType, AGENT_PROFILES, DEFAULT_PROFILE_TYPE } from '../../config/agent-profiles';

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

describe('inferProfileType (path rules, #8)', () => {
  it('no/empty files → default', () => {
    expect(inferProfileType(undefined)).toBe('default');
    expect(inferProfileType([])).toBe('default');
  });
  it('single-domain files map to that domain', () => {
    expect(inferProfileType(['ui/src/components/Button.tsx'])).toBe('ui');
    expect(inferProfileType(['src/routes/api.ts'])).toBe('api');
    expect(inferProfileType(['src/services/todo-store.ts'])).toBe('backend');
    expect(inferProfileType(['packages/shared/util.ts'])).toBe('library');
  });
  it('multi-domain → default (full)', () => {
    expect(inferProfileType(['ui/src/App.tsx', 'src/services/foo.ts'])).toBe('default');
  });
  it('unmatched files → default', () => {
    expect(inferProfileType(['README.md', 'notes.txt'])).toBe('default');
  });
});
