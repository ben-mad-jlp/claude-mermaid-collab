import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AgentAvatar } from '../AgentAvatar';

function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
  if (!m) return rgb.toLowerCase();
  const toHex = (n: string) => parseInt(n, 10).toString(16).padStart(2, '0');
  return `#${toHex(m[1]!)}${toHex(m[2]!)}${toHex(m[3]!)}`;
}

function getBg(el: HTMLElement): string {
  return rgbToHex(el.style.backgroundColor);
}

describe('AgentAvatar', () => {
  it('renders user kind with blue background and "U" when no name', () => {
    const { getByTestId } = render(<AgentAvatar kind="user" />);
    const el = getByTestId('agent-avatar');
    expect(el.textContent).toBe('U');
    expect(getBg(el)).toBe('#3b82f6');
  });

  it('renders user kind with first initial of name', () => {
    const { getByTestId } = render(<AgentAvatar kind="user" name="alice" />);
    const el = getByTestId('agent-avatar');
    expect(el.textContent).toBe('A');
    expect(getBg(el)).toBe('#3b82f6');
  });

  it('renders main_agent with purple background and "C"', () => {
    const { getByTestId } = render(<AgentAvatar kind="main_agent" />);
    const el = getByTestId('agent-avatar');
    expect(el.textContent).toBe('C');
    expect(getBg(el)).toBe('#a855f7');
  });

  it('renders subagent with green background, "S", and name tooltip', () => {
    const { getByTestId } = render(<AgentAvatar kind="subagent" name="explorer" />);
    const el = getByTestId('agent-avatar');
    expect(el.textContent).toBe('S');
    expect(getBg(el)).toBe('#22c55e');
    expect(el.getAttribute('title')).toBe('explorer');
  });

  it('renders hook with amber background and "H"', () => {
    const { getByTestId } = render(<AgentAvatar kind="hook" />);
    const el = getByTestId('agent-avatar');
    expect(el.textContent).toBe('H');
    expect(getBg(el)).toBe('#f59e0b');
  });

  it('renders system with gray background and middle-dot', () => {
    const { getByTestId } = render(<AgentAvatar kind="system" />);
    const el = getByTestId('agent-avatar');
    expect(el.textContent).toBe('\u00B7');
    expect(getBg(el)).toBe('#6b7280');
  });

  it('renders distinct colors and letters across all kinds', () => {
    const kinds = ['user', 'main_agent', 'subagent', 'hook', 'system'] as const;
    const seen = new Map<string, string>();
    for (const kind of kinds) {
      const { getByTestId, unmount } = render(<AgentAvatar kind={kind} />);
      const el = getByTestId('agent-avatar');
      const key = `${getBg(el)}|${el.textContent}`;
      expect(seen.has(key)).toBe(false);
      seen.set(key, kind);
      unmount();
    }
    expect(seen.size).toBe(5);
  });
});
