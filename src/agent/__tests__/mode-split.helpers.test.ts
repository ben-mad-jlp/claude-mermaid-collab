import { describe, expect, it } from 'vitest';
import {
  joinModes,
  splitPermissionMode,
  type PermissionMode,
} from '../contracts';

describe('splitPermissionMode / joinModes', () => {
  const modes: PermissionMode[] = ['supervised', 'accept-edits', 'plan', 'bypass'];

  it('round-trips all PermissionMode values through split -> join', () => {
    for (const m of modes) {
      const { runtime, interaction } = splitPermissionMode(m);
      expect(joinModes(runtime, interaction)).toBe(m);
    }
  });

  it("splitPermissionMode('plan').runtime is 'read-only'", () => {
    expect(splitPermissionMode('plan').runtime).toBe('read-only');
  });

  it("joinModes('bypass','ask') === 'bypass'", () => {
    expect(joinModes('bypass', 'ask')).toBe('bypass');
  });

  it("joinModes('edit','plan') === 'plan'", () => {
    expect(joinModes('edit', 'plan')).toBe('plan');
  });
});
