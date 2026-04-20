import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as React from 'react';

vi.mock('@/hooks/useAgentSession', () => ({
  useAgentSession: () => ({
    send: vi.fn(),
    cancel: vi.fn(),
    resolvePermission: vi.fn(),
    setPermissionMode: vi.fn(),
    commitPushPR: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});

describe('useChatViewBindings', () => {
  it('returns a valid ChatViewProps shape', async () => {
    const { useChatViewBindings } = await import('../useChatViewBindings');
    const { result } = renderHook(() =>
      useChatViewBindings({ sessionId: 's1', renderItem: () => null })
    );
    expect(result.current.items).toEqual([]);
    expect(result.current.composer.value).toBe('');
    expect(typeof result.current.composer.onSend).toBe('function');
    expect(typeof result.current.composer.onChange).toBe('function');
  });

  it('onChange updates the draft store', async () => {
    const { useChatViewBindings } = await import('../useChatViewBindings');
    const { useComposerDraftStore } = await import('@/stores/composerDraftStore');
    const { result } = renderHook(() =>
      useChatViewBindings({ sessionId: 's2', renderItem: () => null })
    );
    act(() => result.current.composer.onChange('hello'));
    expect(useComposerDraftStore.getState().getDraft('s2').plain).toBe('hello');
  });
});
