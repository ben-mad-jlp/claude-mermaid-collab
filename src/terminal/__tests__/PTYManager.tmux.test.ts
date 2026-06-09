import { describe, it, expect } from 'vitest';
import { buildTmuxAttachCommand } from '../PTYManager';

describe('buildTmuxAttachCommand', () => {
  const base = 'mc-myproj-mysess';
  const grouped = 'vscode-collab-mc-myproj-mysess';
  const cmd = buildTmuxAttachCommand(base, grouped);

  it('creates the base session before the grouped session (fixes first-open break)', () => {
    // The base must be created first; otherwise `new-session -t <base>` for the
    // grouped session fails and the && short-circuits, so attach never runs.
    const baseCreate = cmd.indexOf(`new-session -d -s '${base}'`);
    const groupedCreate = cmd.indexOf(`new-session -d -s '${grouped}' -t '${base}'`);
    expect(baseCreate).toBeGreaterThan(-1);
    expect(groupedCreate).toBeGreaterThan(-1);
    expect(baseCreate).toBeLessThan(groupedCreate);
  });

  it('guards each creation with has-session so existing sessions are reused', () => {
    expect(cmd).toContain(`tmux has-session -t '${base}'`);
    expect(cmd).toContain(`tmux has-session -t '${grouped}'`);
  });

  it('uses `;` after the base clause so an existing base does not abort the chain', () => {
    const baseClauseEnd = cmd.indexOf(')') ; // end of first parenthesised clause
    expect(cmd.slice(baseClauseEnd, baseClauseEnd + 3)).toContain(';');
  });

  it('attaches to the grouped session at the end (detaching other clients)', () => {
    expect(cmd.trimEnd().endsWith(`tmux attach-session -d -t '${grouped}'`)).toBe(true);
  });

  describe('stale grouped-session detection (recreated worker under same lane name)', () => {
    it('only reuses an existing grouped session when its group matches the live base', () => {
      // has-session alone is not enough: the grouped session must still be grouped
      // with the LIVE base. We compare #{session_group} of base vs grouped.
      expect(cmd).toContain(`tmux display-message -p -t '${base}' '#{session_group}'`);
      expect(cmd).toContain(`tmux display-message -p -t '${grouped}' '#{session_group}'`);
      // The reuse condition pairs has-session with the group-equality check.
      expect(cmd).toMatch(
        new RegExp(`has-session -t '${grouped}'[^|]*&&[^|]*session_group`),
      );
    });

    it('kills the stale grouped session before recreating it against the live base', () => {
      const kill = cmd.indexOf(`tmux kill-session -t '${grouped}'`);
      const recreate = cmd.indexOf(`new-session -d -s '${grouped}' -t '${base}'`);
      expect(kill).toBeGreaterThan(-1);
      expect(recreate).toBeGreaterThan(-1);
      // kill happens before the recreate so the new group binds to the live base.
      expect(kill).toBeLessThan(recreate);
    });
  });

  describe('without a grouped session (direct base attach)', () => {
    const direct = buildTmuxAttachCommand(base);

    it('creates/reuses the base session and attaches directly to it with -d', () => {
      expect(direct).toContain(`tmux has-session -t '${base}'`);
      expect(direct).toContain(`new-session -d -s '${base}'`);
      expect(direct.trimEnd().endsWith(`tmux attach-session -d -t '${base}'`)).toBe(true);
    });

    it('does not create or reference any grouped/vscode-collab session', () => {
      expect(direct).not.toContain('vscode-collab');
      // Only one new-session (the base) — no grouped `new-session ... -t base`.
      expect((direct.match(/new-session/g) ?? []).length).toBe(1);
    });
  });

  describe('with a cwd (session starts in the project directory)', () => {
    it('passes -c <cwd> to the base new-session so panes start there', () => {
      const withCwd = buildTmuxAttachCommand(base, undefined, '/Users/me/proj');
      expect(withCwd).toContain(`new-session -d -s '${base}' -c '/Users/me/proj'`);
    });

    it('omits -c entirely when no cwd is given', () => {
      expect(buildTmuxAttachCommand(base)).not.toContain(' -c ');
    });

    it('single-quote-escapes the cwd to survive odd directory names', () => {
      const withCwd = buildTmuxAttachCommand(base, undefined, "/tmp/a'b");
      expect(withCwd).toContain(`-c '/tmp/a'\\''b'`);
    });
  });
});
