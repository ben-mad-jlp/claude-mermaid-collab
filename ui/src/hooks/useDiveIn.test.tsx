/**
 * useDiveIn / useSelectSessionInPlace — both hooks route session selection
 * through the shared selectSession() helper, which must also repoint
 * uiStore.activeProject so it doesn't lag behind the actually-selected session.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiveIn, useSelectSessionInPlace } from './useDiveIn';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';

beforeEach(() => {
  useUIStore.setState({ activeProject: null, mode: 'bridge' });
  useSessionStore.setState({ currentSession: null, sessions: [] });
});

describe('useDiveIn / useSelectSessionInPlace — activeProject follows selection', () => {
  it("useSelectSessionInPlace sets uiStore.activeProject to the selected session's project", () => {
    useUIStore.setState({ activeProject: '/abs/a' });
    const { result } = renderHook(() => useSelectSessionInPlace());

    act(() => result.current({ project: '/abs/b', session: 'w1' }));

    expect(useUIStore.getState().activeProject).toBe('/abs/b');
    expect(useSessionStore.getState().currentSession?.project).toBe('/abs/b');
  });

  it("useDiveIn sets uiStore.activeProject to the selected session's project and switches to studio mode", () => {
    useUIStore.setState({ activeProject: '/abs/a' });
    const { result } = renderHook(() => useDiveIn());

    act(() => result.current({ project: '/abs/b', session: 'w1' }));

    expect(useUIStore.getState().activeProject).toBe('/abs/b');
    expect(useSessionStore.getState().currentSession?.project).toBe('/abs/b');
    expect(useUIStore.getState().mode).toBe('studio');
  });

  it('leaves activeProject untouched when no selection is performed', () => {
    useUIStore.setState({ activeProject: '/abs/a' });
    renderHook(() => useDiveIn());

    expect(useUIStore.getState().activeProject).toBe('/abs/a');
  });
});
