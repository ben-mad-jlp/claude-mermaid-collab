import { describe, it, expect } from 'vitest';
import {
  ROLE_TOOLS,
  TOOL_MUTATES_TREE,
  isReadOnlyRole,
  assertRoleCapable,
  resolveRoleTools,
  type SubloopRole,
} from '../capabilities';

const ROLES: SubloopRole[] = ['sizegate', 'research', 'implement', 'verify', 'review'];

describe('worker-core capabilities', () => {
  it('every read-only role declares ZERO tree-mutating tools (the structural invariant)', () => {
    for (const role of ROLES) {
      if (!isReadOnlyRole(role)) continue;
      const mutating = ROLE_TOOLS[role].filter((t) => TOOL_MUTATES_TREE[t]);
      expect(mutating, `role ${role}`).toEqual([]);
    }
  });

  it('implement is the sole writer (has write_file + edit)', () => {
    expect(isReadOnlyRole('implement')).toBe(false);
    expect(ROLE_TOOLS.implement).toContain('write_file');
    expect(ROLE_TOOLS.implement).toContain('edit');
  });

  it('research can post diagrams but cannot mutate the tree', () => {
    expect(ROLE_TOOLS.research).toContain('create_diagram');
    expect(TOOL_MUTATES_TREE.create_diagram).toBe(false); // design store, not the worktree
    expect(ROLE_TOOLS.research).not.toContain('write_file');
  });

  it('resolveRoleTools returns the declared set for every role without throwing', () => {
    for (const role of ROLES) expect(resolveRoleTools(role).length).toBeGreaterThan(0);
  });

  it('assertRoleCapable throws if a read-only role is handed a mutating tool', () => {
    expect(() => assertRoleCapable('verify', ['read_file', 'write_file'])).toThrow(/must not receive/);
    expect(() => assertRoleCapable('implement', ['write_file'])).not.toThrow();
  });
});
