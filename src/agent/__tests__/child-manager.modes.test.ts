import { describe, it, expect } from 'bun:test';
import { runtimeModeToFlags } from '../child-manager.ts';

describe('runtimeModeToFlags', () => {
  it('read-only includes a disallowed-tools flag denying writes + Bash', () => {
    const flags = runtimeModeToFlags('read-only');
    // Claude CLI uses --disallowedTools (not --deny-tools).
    expect(flags).toContain('--disallowedTools');
    const idx = flags.indexOf('--disallowedTools');
    const value = flags[idx + 1] ?? '';
    expect(value).toContain('Edit');
    expect(value).toContain('Write');
    expect(value).toContain('MultiEdit');
    expect(value).toContain('NotebookEdit');
    expect(value).toContain('Bash');
  });

  it('edit emits no extra flags', () => {
    expect(runtimeModeToFlags('edit')).toEqual([]);
  });

  it('bypass includes --dangerously-skip-permissions', () => {
    expect(runtimeModeToFlags('bypass')).toContain('--dangerously-skip-permissions');
  });
});
