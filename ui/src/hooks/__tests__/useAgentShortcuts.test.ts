import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentShortcuts } from '../useAgentShortcuts';

function fire(key: string, opts: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('useAgentShortcuts', () => {
  it('Cmd+Enter calls onSend', () => {
    const onSend = vi.fn();
    renderHook(() => useAgentShortcuts({ onSend }));
    fire('Enter', { metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('plain Enter does not call onSend', () => {
    const onSend = vi.fn();
    renderHook(() => useAgentShortcuts({ onSend }));
    fire('Enter');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Escape calls onCancel', () => {
    const onCancel = vi.fn();
    renderHook(() => useAgentShortcuts({ onCancel }));
    fire('Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Cmd+K calls onFocus', () => {
    const onFocus = vi.fn();
    renderHook(() => useAgentShortcuts({ onFocus }));
    fire('k', { metaKey: true });
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('Cmd+/ calls onSlash', () => {
    const onSlash = vi.fn();
    renderHook(() => useAgentShortcuts({ onSlash }));
    fire('/', { metaKey: true });
    expect(onSlash).toHaveBeenCalledTimes(1);
  });

  it('Cmd+@ calls onMention', () => {
    const onMention = vi.fn();
    renderHook(() => useAgentShortcuts({ onMention }));
    fire('@', { metaKey: true });
    expect(onMention).toHaveBeenCalledTimes(1);
  });

  it('enabled:false disables shortcuts', () => {
    const onSend = vi.fn();
    renderHook(() => useAgentShortcuts({ onSend, enabled: false }));
    fire('Enter', { metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('unmount removes listener', () => {
    const onSend = vi.fn();
    const { unmount } = renderHook(() => useAgentShortcuts({ onSend }));
    unmount();
    fire('Enter', { metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });
});
