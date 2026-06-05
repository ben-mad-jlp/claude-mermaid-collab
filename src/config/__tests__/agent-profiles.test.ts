import { describe, it, expect } from 'bun:test';
import {
  AGENT_PROFILES,
  CAPABILITIES,
  DEFAULT_CAPABILITY,
  DEFAULT_PROFILE_TYPE,
  capabilitySpec,
  resolveCapability,
  resolveProfile,
  type Capability,
} from '../agent-profiles';

describe('capability layer (Profile L1)', () => {
  it('defines exactly the three global capabilities', () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(['edit', 'headless', 'reviewer']);
  });

  it('defaults to edit', () => {
    expect(DEFAULT_CAPABILITY).toBe('edit');
  });

  describe('resolveCapability — decoupled from routing type', () => {
    it('missing / null / unknown → edit default', () => {
      expect(resolveCapability()).toBe('edit');
      expect(resolveCapability(null)).toBe('edit');
      expect(resolveCapability('frontend')).toBe('edit'); // a routing type is NOT a capability
      expect(resolveCapability('nonsense')).toBe('edit');
    });

    it('honours an explicit reviewer request', () => {
      expect(resolveCapability('reviewer')).toBe('reviewer');
    });

    it('NEVER auto-selects headless — even when named, without explicit trust', () => {
      expect(resolveCapability('headless')).toBe('edit');
      expect(resolveCapability('headless', {})).toBe('edit');
      expect(resolveCapability('headless', { allowHeadless: false })).toBe('edit');
    });

    it('honours headless ONLY with the explicit allowHeadless opt-in', () => {
      expect(resolveCapability('headless', { allowHeadless: true })).toBe('headless');
    });
  });

  describe('capabilitySpec — tools/permissions per capability', () => {
    it('edit is the full edit surface', () => {
      const s = capabilitySpec('edit');
      expect(s.runtimeMode).toBe('edit');
      expect(s.allowedTools).toContain('Edit');
      expect(s.allowedTools).toContain('Write');
    });

    it('reviewer is read-only and cannot edit/write', () => {
      const s = capabilitySpec('reviewer');
      expect(s.runtimeMode).toBe('read-only');
      expect(s.allowedTools).not.toContain('Edit');
      expect(s.allowedTools).not.toContain('Write');
    });

    it('headless is bypass', () => {
      expect(capabilitySpec('headless').runtimeMode).toBe('bypass');
    });
  });
});

describe('resolveProfile capability application', () => {
  it('no capability → exact global object identity is preserved', () => {
    expect(resolveProfile('backend')).toBe(AGENT_PROFILES.backend);
    expect(resolveProfile()).toBe(AGENT_PROFILES[DEFAULT_PROFILE_TYPE]);
  });

  it('a capability applies over ANY routing type (decoupling)', () => {
    for (const type of ['frontend', 'backend', 'ui'] as const) {
      const p = resolveProfile(type, undefined, 'reviewer');
      expect(p.capability).toBe('reviewer');
      expect(p.runtimeMode).toBe('read-only');
      expect(p.allowedTools).not.toContain('Write');
    }
  });

  it('headless capability, once resolved, yields a bypass profile', () => {
    const cap: Capability = resolveCapability('headless', { allowHeadless: true });
    const p = resolveProfile('backend', undefined, cap);
    expect(p.capability).toBe('headless');
    expect(p.runtimeMode).toBe('bypass');
  });

  it('default edit capability keeps the edit surface', () => {
    const p = resolveProfile('backend', undefined, 'edit');
    expect(p.capability).toBe('edit');
    expect(p.runtimeMode).toBe('edit');
    expect(p.allowedTools).toContain('Write');
  });
});
