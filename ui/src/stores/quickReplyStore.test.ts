import { describe, it, expect } from 'vitest';
import { useQuickReplyStore } from './quickReplyStore';

describe('quickReplyStore', () => {
  it('sendOnEnter defaults to on', () => {
    const state = useQuickReplyStore.getState();
    expect(state.sendOnEnter).toBe(true);
  });

  it('setSendOnEnter updates the toggle', () => {
    const state = useQuickReplyStore.getState();
    state.setSendOnEnter(false);
    expect(useQuickReplyStore.getState().sendOnEnter).toBe(false);
    // Reset
    state.setSendOnEnter(true);
    expect(useQuickReplyStore.getState().sendOnEnter).toBe(true);
  });

  it('suggestReplyDisplay defaults to on', () => {
    const state = useQuickReplyStore.getState();
    expect(state.suggestReplyDisplay).toBe(true);
  });

  it('setSuggestReplyDisplay updates the toggle', () => {
    const state = useQuickReplyStore.getState();
    state.setSuggestReplyDisplay(false);
    expect(useQuickReplyStore.getState().suggestReplyDisplay).toBe(false);
    // Reset
    state.setSuggestReplyDisplay(true);
    expect(useQuickReplyStore.getState().suggestReplyDisplay).toBe(true);
  });
});
