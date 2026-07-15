import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutocorrect } from './useAutocorrect';
import { addToPersonalDict } from '@/lib/autocorrect/personalDict';

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel: any) =>
    sel({
      todosByProject: { p: [{ title: 'Bridge mission reclaim' }] },
      supervised: [],
    }),
}));

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: (sel: any) => sel({ documents: [] }),
}));

vi.mock('@/stores/quickReplyStore', () => ({
  useQuickReplyStore: (sel: any) => sel({ autocorrectMode: 'suggest' }),
}));

describe('useAutocorrect', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    global.localStorage = {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it('corrects a token against a todo-title vocab', () => {
    const { result } = renderHook(() => useAutocorrect('p'));
    const suggestion = result.current.correct('misison');
    expect(suggestion).toMatchObject({ to: 'mission' });
  });

  it('protects a personal-dict word', () => {
    addToPersonalDict('p', 'reclaim');
    const { result } = renderHook(() => useAutocorrect('p'));
    expect(result.current.correct('reclaim')).toBeNull();
  });

  it('exposes mode from the quick-reply store', () => {
    const { result } = renderHook(() => useAutocorrect('p'));
    expect(result.current.mode).toBe('suggest');
  });
});
