import { describe, it, expect } from 'vitest';
import { useQuickReplyStore } from './quickReplyStore';

describe('quickReplyStore', () => {
  it('autocorrectMode defaults to off', () => {
    const state = useQuickReplyStore.getState();
    expect(state.autocorrectMode).toBe('off');
  });

  it('setAutocorrectMode updates the mode', () => {
    const state = useQuickReplyStore.getState();
    state.setAutocorrectMode('auto');
    expect(useQuickReplyStore.getState().autocorrectMode).toBe('auto');
    // Reset
    state.setAutocorrectMode('off');
    expect(useQuickReplyStore.getState().autocorrectMode).toBe('off');
  });
});
