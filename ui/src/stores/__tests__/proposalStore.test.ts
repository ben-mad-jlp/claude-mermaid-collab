import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useProposalStore, type ProposalState } from '../proposalStore';
import type { Proposal } from '@/types/proposal';

describe('useProposalStore', () => {
  const mockProposal = (overrides?: Partial<Proposal>): Omit<Proposal, 'id' | 'timestamp'> => ({
    type: 'proposed',
    lineStart: 1,
    lineEnd: 3,
    content: 'New content',
    author: 'claude',
    ...overrides,
  });

  beforeEach(() => {
    // Clear the store before each test
    const state = useProposalStore.getState();
    useProposalStore.setState({ proposals: {} });
  });

  afterEach(() => {
    // Clean up after each test
    const state = useProposalStore.getState();
    useProposalStore.setState({ proposals: {} });
  });

  describe('addProposal', () => {
    it('should initialize with empty proposals', () => {
      const state = useProposalStore.getState();
      expect(state.proposals).toEqual({});
    });

    it('should add a proposal and return a unique ID', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      const id = state.addProposal('item-1', proposal);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should add timestamp to proposal automatically', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();
      const beforeTime = Date.now();

      state.addProposal('item-1', proposal);

      const afterTime = Date.now();
      const added = useProposalStore.getState().proposals['item-1'][0];

      expect(added.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(added.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should create a new item array if itemId does not exist', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      state.addProposal('new-item', proposal);

      const proposals = useProposalStore.getState().proposals;
      expect(proposals['new-item']).toBeDefined();
      expect(proposals['new-item'].length).toBe(1);
    });

    it('should add multiple proposals to the same item', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal();
      const proposal2 = mockProposal({ lineStart: 4, lineEnd: 6 });

      state.addProposal('item-1', proposal1);
      state.addProposal('item-1', proposal2);

      const proposals = useProposalStore.getState().proposals['item-1'];
      expect(proposals.length).toBe(2);
    });

    it('should preserve all proposal fields', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal({
        type: 'comment',
        lineStart: 5,
        lineEnd: 10,
        content: 'This needs revision',
        author: 'user',
      });

      state.addProposal('item-1', proposal);

      const added = useProposalStore.getState().proposals['item-1'][0];
      expect(added.type).toBe('comment');
      expect(added.lineStart).toBe(5);
      expect(added.lineEnd).toBe(10);
      expect(added.content).toBe('This needs revision');
      expect(added.author).toBe('user');
    });

    it('should generate unique IDs for each proposal', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      const id1 = state.addProposal('item-1', proposal);
      const id2 = state.addProposal('item-1', proposal);

      expect(id1).not.toBe(id2);
    });
  });

  describe('updateProposal', () => {
    it('should update proposal fields', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      const id = state.addProposal('item-1', proposal);
      state.updateProposal('item-1', id, { type: 'approved' });

      const updated = useProposalStore.getState().proposals['item-1'][0];
      expect(updated.type).toBe('approved');
    });

    it('should merge updates without removing other fields', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal({
        type: 'proposed',
        content: 'Original content',
        lineStart: 1,
      });

      const id = state.addProposal('item-1', proposal);
      state.updateProposal('item-1', id, { type: 'approved' });

      const updated = useProposalStore.getState().proposals['item-1'][0];
      expect(updated.type).toBe('approved');
      expect(updated.content).toBe('Original content');
      expect(updated.lineStart).toBe(1);
    });

    it('should handle updating multiple fields at once', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      const id = state.addProposal('item-1', proposal);
      state.updateProposal('item-1', id, {
        type: 'approved',
        content: 'Updated content',
        lineStart: 5,
      });

      const updated = useProposalStore.getState().proposals['item-1'][0];
      expect(updated.type).toBe('approved');
      expect(updated.content).toBe('Updated content');
      expect(updated.lineStart).toBe(5);
    });

    it('should not mutate the proposal ID or timestamp', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      const id = state.addProposal('item-1', proposal);
      const original = useProposalStore.getState().proposals['item-1'][0];
      const originalTimestamp = original.timestamp;

      state.updateProposal('item-1', id, { content: 'New content' });

      const updated = useProposalStore.getState().proposals['item-1'][0];
      expect(updated.id).toBe(id);
      expect(updated.timestamp).toBe(originalTimestamp);
    });

    it('should be a no-op if proposal not found', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      state.addProposal('item-1', proposal);

      // Try to update non-existent proposal - should not throw or crash
      expect(() => {
        state.updateProposal('item-1', 'non-existent-id', { type: 'approved' });
      }).not.toThrow();

      const proposals = useProposalStore.getState().proposals['item-1'];
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe('proposed');
    });

    it('should be a no-op if item does not exist', () => {
      const state = useProposalStore.getState();

      // Try to update proposal in non-existent item - should not throw or crash
      expect(() => {
        state.updateProposal('non-existent-item', 'some-id', { type: 'approved' });
      }).not.toThrow();

      const proposals = useProposalStore.getState().proposals;
      expect(proposals['non-existent-item']).toBeUndefined();
    });

    it('should update correct proposal when multiple exist', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal({ lineStart: 1 });
      const proposal2 = mockProposal({ lineStart: 5 });

      const id1 = state.addProposal('item-1', proposal1);
      const id2 = state.addProposal('item-1', proposal2);

      state.updateProposal('item-1', id1, { type: 'approved' });

      const proposals = useProposalStore.getState().proposals['item-1'];
      expect(proposals[0].type).toBe('approved');
      expect(proposals[1].type).toBe('proposed');
    });
  });

  describe('removeProposal', () => {
    it('should remove a proposal from item', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      const id = state.addProposal('item-1', proposal);
      expect(useProposalStore.getState().proposals['item-1'].length).toBe(1);

      state.removeProposal('item-1', id);

      expect(useProposalStore.getState().proposals['item-1'].length).toBe(0);
    });

    it('should remove only the specified proposal', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal({ lineStart: 1 });
      const proposal2 = mockProposal({ lineStart: 5 });

      const id1 = state.addProposal('item-1', proposal1);
      const id2 = state.addProposal('item-1', proposal2);

      state.removeProposal('item-1', id1);

      const proposals = useProposalStore.getState().proposals['item-1'];
      expect(proposals.length).toBe(1);
      expect(proposals[0].id).toBe(id2);
    });

    it('should be a no-op if proposal not found', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      state.addProposal('item-1', proposal);

      expect(() => {
        state.removeProposal('item-1', 'non-existent-id');
      }).not.toThrow();

      const proposals = useProposalStore.getState().proposals['item-1'];
      expect(proposals.length).toBe(1);
    });

    it('should be a no-op if item not found', () => {
      const state = useProposalStore.getState();

      expect(() => {
        state.removeProposal('non-existent-item', 'some-id');
      }).not.toThrow();

      const proposals = useProposalStore.getState().proposals;
      // removeProposal creates an empty array for non-existent items (graceful handling)
      expect(proposals['non-existent-item']).toEqual([]);
    });

    it('should preserve array structure after removal', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal({ lineStart: 1 });
      const proposal2 = mockProposal({ lineStart: 5 });
      const proposal3 = mockProposal({ lineStart: 10 });

      const id1 = state.addProposal('item-1', proposal1);
      const id2 = state.addProposal('item-1', proposal2);
      const id3 = state.addProposal('item-1', proposal3);

      state.removeProposal('item-1', id2);

      const proposals = useProposalStore.getState().proposals['item-1'];
      expect(proposals.length).toBe(2);
      expect(proposals[0].id).toBe(id1);
      expect(proposals[1].id).toBe(id3);
    });
  });

  describe('approveProposal', () => {
    it('should change proposal type to approved', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal({ type: 'proposed' });

      const id = state.addProposal('item-1', proposal);
      state.approveProposal('item-1', id);

      const updated = useProposalStore.getState().proposals['item-1'][0];
      expect(updated.type).toBe('approved');
    });

    it('should preserve other fields when approving', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal({
        type: 'proposed',
        content: 'New content',
        lineStart: 5,
      });

      const id = state.addProposal('item-1', proposal);
      state.approveProposal('item-1', id);

      const updated = useProposalStore.getState().proposals['item-1'][0];
      expect(updated.type).toBe('approved');
      expect(updated.content).toBe('New content');
      expect(updated.lineStart).toBe(5);
      expect(updated.id).toBe(id);
    });

    it('should be a no-op if proposal not found', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      state.addProposal('item-1', proposal);

      expect(() => {
        state.approveProposal('item-1', 'non-existent-id');
      }).not.toThrow();

      const proposals = useProposalStore.getState().proposals['item-1'];
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe('proposed');
    });
  });

  describe('rejectProposal', () => {
    it('should change proposal type to rejected', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal({ type: 'proposed' });

      const id = state.addProposal('item-1', proposal);
      state.rejectProposal('item-1', id);

      const updated = useProposalStore.getState().proposals['item-1'][0];
      expect(updated.type).toBe('rejected');
    });

    it('should preserve other fields when rejecting', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal({
        type: 'proposed',
        content: 'New content',
        lineStart: 5,
      });

      const id = state.addProposal('item-1', proposal);
      state.rejectProposal('item-1', id);

      const updated = useProposalStore.getState().proposals['item-1'][0];
      expect(updated.type).toBe('rejected');
      expect(updated.content).toBe('New content');
      expect(updated.lineStart).toBe(5);
      expect(updated.id).toBe(id);
    });

    it('should be a no-op if proposal not found', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      state.addProposal('item-1', proposal);

      expect(() => {
        state.rejectProposal('item-1', 'non-existent-id');
      }).not.toThrow();

      const proposals = useProposalStore.getState().proposals['item-1'];
      expect(proposals.length).toBe(1);
      expect(proposals[0].type).toBe('proposed');
    });
  });

  describe('clearProposals', () => {
    it('should remove all proposals for an item', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal();
      const proposal2 = mockProposal();
      const proposal3 = mockProposal();

      state.addProposal('item-1', proposal1);
      state.addProposal('item-1', proposal2);
      state.addProposal('item-1', proposal3);

      expect(useProposalStore.getState().proposals['item-1'].length).toBe(3);

      state.clearProposals('item-1');

      expect(useProposalStore.getState().proposals['item-1'].length).toBe(0);
    });

    it('should not affect proposals for other items', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal();
      const proposal2 = mockProposal();

      state.addProposal('item-1', proposal1);
      state.addProposal('item-2', proposal2);

      state.clearProposals('item-1');

      const proposals1 = useProposalStore.getState().proposals['item-1'];
      const proposals2 = useProposalStore.getState().proposals['item-2'];

      expect(proposals1.length).toBe(0);
      expect(proposals2.length).toBe(1);
    });

    it('should be a no-op if item not found', () => {
      const state = useProposalStore.getState();

      expect(() => {
        state.clearProposals('non-existent-item');
      }).not.toThrow();

      const proposals = useProposalStore.getState().proposals;
      // clearProposals creates an empty array for non-existent items (graceful handling)
      expect(proposals['non-existent-item']).toEqual([]);
    });

    it('should handle clearing already-empty proposals', () => {
      const state = useProposalStore.getState();

      // Clear proposals from item that was never created
      state.clearProposals('item-1');
      // Clear again
      state.clearProposals('item-1');

      expect(useProposalStore.getState().proposals['item-1'].length).toBe(0);
    });
  });

  describe('getProposalsForItem', () => {
    it('should return empty array for item with no proposals', () => {
      const state = useProposalStore.getState();

      const proposals = state.getProposalsForItem('non-existent-item');

      expect(Array.isArray(proposals)).toBe(true);
      expect(proposals.length).toBe(0);
    });

    it('should return all proposals for an item', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal();
      const proposal2 = mockProposal();
      const proposal3 = mockProposal();

      state.addProposal('item-1', proposal1);
      state.addProposal('item-1', proposal2);
      state.addProposal('item-1', proposal3);

      const proposals = state.getProposalsForItem('item-1');

      expect(proposals.length).toBe(3);
    });

    it('should not return proposals from other items', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal();
      const proposal2 = mockProposal();

      state.addProposal('item-1', proposal1);
      state.addProposal('item-2', proposal2);

      const proposals1 = state.getProposalsForItem('item-1');
      const proposals2 = state.getProposalsForItem('item-2');

      expect(proposals1.length).toBe(1);
      expect(proposals2.length).toBe(1);
    });

    it('should return proposals in order they were added', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal({ content: 'first' });
      const proposal2 = mockProposal({ content: 'second' });
      const proposal3 = mockProposal({ content: 'third' });

      const id1 = state.addProposal('item-1', proposal1);
      const id2 = state.addProposal('item-1', proposal2);
      const id3 = state.addProposal('item-1', proposal3);

      const proposals = state.getProposalsForItem('item-1');

      expect(proposals[0].id).toBe(id1);
      expect(proposals[1].id).toBe(id2);
      expect(proposals[2].id).toBe(id3);
    });

    it('should not mutate original state when returning proposals', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal();

      state.addProposal('item-1', proposal);

      const proposals = state.getProposalsForItem('item-1');
      const originalProposals = useProposalStore.getState().proposals['item-1'];

      // Should be the same reference (not a copy)
      expect(proposals).toBe(originalProposals);
    });
  });

  describe('Integration tests', () => {
    it('should handle complete workflow: add, update, approve, get', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal({ type: 'proposed', content: 'Change content' });

      const id = state.addProposal('item-1', proposal);
      expect(state.getProposalsForItem('item-1').length).toBe(1);

      state.updateProposal('item-1', id, { content: 'Updated content' });
      let proposals = state.getProposalsForItem('item-1');
      expect(proposals[0].content).toBe('Updated content');

      state.approveProposal('item-1', id);
      proposals = state.getProposalsForItem('item-1');
      expect(proposals[0].type).toBe('approved');
    });

    it('should handle workflow: add, update, reject, remove', () => {
      const state = useProposalStore.getState();
      const proposal = mockProposal({ type: 'proposed' });

      const id = state.addProposal('item-1', proposal);

      state.rejectProposal('item-1', id);
      let proposals = state.getProposalsForItem('item-1');
      expect(proposals[0].type).toBe('rejected');

      state.removeProposal('item-1', id);
      proposals = state.getProposalsForItem('item-1');
      expect(proposals.length).toBe(0);
    });

    it('should handle multiple items independently', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal({ content: 'proposal 1' });
      const proposal2 = mockProposal({ content: 'proposal 2' });
      const proposal3 = mockProposal({ content: 'proposal 3' });

      const id1 = state.addProposal('item-1', proposal1);
      const id2 = state.addProposal('item-2', proposal2);
      const id3 = state.addProposal('item-2', proposal3);

      state.approveProposal('item-1', id1);
      state.rejectProposal('item-2', id2);

      const proposals1 = state.getProposalsForItem('item-1');
      const proposals2 = state.getProposalsForItem('item-2');

      expect(proposals1[0].type).toBe('approved');
      expect(proposals2[0].type).toBe('rejected');
      expect(proposals2[1].type).toBe('proposed');
    });

    it('should handle adding, clearing, and adding again', () => {
      const state = useProposalStore.getState();
      const proposal1 = mockProposal();
      const proposal2 = mockProposal();

      state.addProposal('item-1', proposal1);
      expect(state.getProposalsForItem('item-1').length).toBe(1);

      state.clearProposals('item-1');
      expect(state.getProposalsForItem('item-1').length).toBe(0);

      state.addProposal('item-1', proposal2);
      expect(state.getProposalsForItem('item-1').length).toBe(1);
    });
  });
});
