import { describe, it, expect } from 'vitest';
import { summarize } from './ChatView.logic';

describe('summarize', () => {
  it('counts items and tracks streaming/pending flags', () => {
    const s = summarize([{ id: 'a', kind: 'message' }], 'a', null);
    expect(s.itemCount).toBe(1);
    expect(s.hasStreaming).toBe(true);
    expect(s.hasPendingApproval).toBe(false);
  });
});
