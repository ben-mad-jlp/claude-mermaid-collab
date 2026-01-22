/**
 * Proposal Type Tests
 *
 * Tests for:
 * - ProposalType enum validation
 * - ProposalAuthor enum validation
 * - Proposal interface structure
 * - ProposalState interface structure
 * - Type compatibility and constraints
 */

import { describe, it, expect } from 'vitest';
import type {
  Proposal,
  ProposalState,
  ProposalType,
  ProposalAuthor,
} from '../proposal';

describe('Proposal Types', () => {
  describe('ProposalType', () => {
    it('accepts valid proposal types', () => {
      const types: ProposalType[] = ['comment', 'proposed', 'approved', 'rejected'];
      expect(types).toHaveLength(4);
      expect(types[0]).toBe('comment');
      expect(types[1]).toBe('proposed');
      expect(types[2]).toBe('approved');
      expect(types[3]).toBe('rejected');
    });
  });

  describe('ProposalAuthor', () => {
    it('accepts valid proposal authors', () => {
      const authors: ProposalAuthor[] = ['user', 'claude'];
      expect(authors).toHaveLength(2);
      expect(authors[0]).toBe('user');
      expect(authors[1]).toBe('claude');
    });
  });

  describe('Proposal interface', () => {
    it('creates proposal with required fields', () => {
      const proposal: Proposal = {
        id: 'p1',
        type: 'comment',
        lineStart: 1,
        lineEnd: 5,
        content: 'Test comment',
        author: 'user',
        timestamp: Date.now(),
      };

      expect(proposal.id).toBe('p1');
      expect(proposal.type).toBe('comment');
      expect(proposal.lineStart).toBe(1);
      expect(proposal.lineEnd).toBe(5);
      expect(proposal.content).toBe('Test comment');
      expect(proposal.author).toBe('user');
      expect(typeof proposal.timestamp).toBe('number');
    });

    it('creates proposal with optional originalContent field', () => {
      const proposal: Proposal = {
        id: 'p2',
        type: 'proposed',
        lineStart: 10,
        lineEnd: 15,
        content: 'New content',
        originalContent: 'Old content',
        author: 'claude',
        timestamp: Date.now(),
      };

      expect(proposal.originalContent).toBe('Old content');
    });

    it('creates proposal without originalContent field', () => {
      const proposal: Proposal = {
        id: 'p3',
        type: 'comment',
        lineStart: 1,
        lineEnd: 1,
        content: 'Just a comment',
        author: 'user',
        timestamp: Date.now(),
      };

      expect(proposal.originalContent).toBeUndefined();
    });

    it('supports all proposal types in interface', () => {
      const types: ProposalType[] = ['comment', 'proposed', 'approved', 'rejected'];

      types.forEach((type) => {
        const proposal: Proposal = {
          id: `p-${type}`,
          type,
          lineStart: 1,
          lineEnd: 1,
          content: `Test ${type}`,
          author: 'user',
          timestamp: Date.now(),
        };
        expect(proposal.type).toBe(type);
      });
    });

    it('supports all author types in interface', () => {
      const authors: ProposalAuthor[] = ['user', 'claude'];

      authors.forEach((author) => {
        const proposal: Proposal = {
          id: `p-${author}`,
          type: 'comment',
          lineStart: 1,
          lineEnd: 1,
          content: `By ${author}`,
          author,
          timestamp: Date.now(),
        };
        expect(proposal.author).toBe(author);
      });
    });
  });

  describe('ProposalState interface', () => {
    it('defines proposals property as Record<string, Proposal[]>', () => {
      const state: ProposalState = {
        proposals: {
          item1: [],
          item2: [],
        },
        addProposal: () => 'id',
        updateProposal: () => {},
        removeProposal: () => {},
        approveProposal: () => {},
        rejectProposal: () => {},
        clearProposals: () => {},
        getProposalsForItem: () => [],
      };

      expect(state.proposals).toHaveProperty('item1');
      expect(state.proposals).toHaveProperty('item2');
      expect(state.proposals.item1).toEqual([]);
      expect(state.proposals.item2).toEqual([]);
    });

    it('defines addProposal method with correct signature', () => {
      const state: ProposalState = {
        proposals: {},
        addProposal: (itemId: string, proposal: Omit<Proposal, 'id' | 'timestamp'>) => {
          expect(typeof itemId).toBe('string');
          expect(typeof proposal).toBe('object');
          return 'generated-id';
        },
        updateProposal: () => {},
        removeProposal: () => {},
        approveProposal: () => {},
        rejectProposal: () => {},
        clearProposals: () => {},
        getProposalsForItem: () => [],
      };

      const id = state.addProposal('item1', {
        type: 'comment',
        lineStart: 1,
        lineEnd: 1,
        content: 'Test',
        author: 'user',
      });

      expect(id).toBe('generated-id');
    });

    it('defines updateProposal method with correct signature', () => {
      const state: ProposalState = {
        proposals: {},
        addProposal: () => 'id',
        updateProposal: (
          itemId: string,
          proposalId: string,
          updates: Partial<Proposal>
        ) => {
          expect(typeof itemId).toBe('string');
          expect(typeof proposalId).toBe('string');
          expect(typeof updates).toBe('object');
        },
        removeProposal: () => {},
        approveProposal: () => {},
        rejectProposal: () => {},
        clearProposals: () => {},
        getProposalsForItem: () => [],
      };

      state.updateProposal('item1', 'p1', { type: 'approved' });
    });

    it('defines removeProposal method with correct signature', () => {
      const state: ProposalState = {
        proposals: {},
        addProposal: () => 'id',
        updateProposal: () => {},
        removeProposal: (itemId: string, proposalId: string) => {
          expect(typeof itemId).toBe('string');
          expect(typeof proposalId).toBe('string');
        },
        approveProposal: () => {},
        rejectProposal: () => {},
        clearProposals: () => {},
        getProposalsForItem: () => [],
      };

      state.removeProposal('item1', 'p1');
    });

    it('defines approveProposal method with correct signature', () => {
      const state: ProposalState = {
        proposals: {},
        addProposal: () => 'id',
        updateProposal: () => {},
        removeProposal: () => {},
        approveProposal: (itemId: string, proposalId: string) => {
          expect(typeof itemId).toBe('string');
          expect(typeof proposalId).toBe('string');
        },
        rejectProposal: () => {},
        clearProposals: () => {},
        getProposalsForItem: () => [],
      };

      state.approveProposal('item1', 'p1');
    });

    it('defines rejectProposal method with correct signature', () => {
      const state: ProposalState = {
        proposals: {},
        addProposal: () => 'id',
        updateProposal: () => {},
        removeProposal: () => {},
        approveProposal: () => {},
        rejectProposal: (itemId: string, proposalId: string) => {
          expect(typeof itemId).toBe('string');
          expect(typeof proposalId).toBe('string');
        },
        clearProposals: () => {},
        getProposalsForItem: () => [],
      };

      state.rejectProposal('item1', 'p1');
    });

    it('defines clearProposals method with correct signature', () => {
      const state: ProposalState = {
        proposals: {},
        addProposal: () => 'id',
        updateProposal: () => {},
        removeProposal: () => {},
        approveProposal: () => {},
        rejectProposal: () => {},
        clearProposals: (itemId: string) => {
          expect(typeof itemId).toBe('string');
        },
        getProposalsForItem: () => [],
      };

      state.clearProposals('item1');
    });

    it('defines getProposalsForItem method with correct signature', () => {
      const proposals: Proposal[] = [
        {
          id: 'p1',
          type: 'comment',
          lineStart: 1,
          lineEnd: 1,
          content: 'Test',
          author: 'user',
          timestamp: Date.now(),
        },
      ];

      const state: ProposalState = {
        proposals: {},
        addProposal: () => 'id',
        updateProposal: () => {},
        removeProposal: () => {},
        approveProposal: () => {},
        rejectProposal: () => {},
        clearProposals: () => {},
        getProposalsForItem: (itemId: string) => {
          expect(typeof itemId).toBe('string');
          return proposals;
        },
      };

      const result = state.getProposalsForItem('item1');
      expect(result).toEqual(proposals);
      expect(result).toHaveLength(1);
    });
  });

  describe('Type constraints', () => {
    it('Proposal requires all fields except originalContent', () => {
      const requiredFields = ['id', 'type', 'lineStart', 'lineEnd', 'content', 'author', 'timestamp'];

      const proposal: Proposal = {
        id: 'p1',
        type: 'comment',
        lineStart: 1,
        lineEnd: 5,
        content: 'Test',
        author: 'user',
        timestamp: Date.now(),
      };

      requiredFields.forEach((field) => {
        expect(field in proposal).toBe(true);
      });
    });

    it('ProposalState has all required methods', () => {
      const methodNames = [
        'addProposal',
        'updateProposal',
        'removeProposal',
        'approveProposal',
        'rejectProposal',
        'clearProposals',
        'getProposalsForItem',
      ];

      const state: ProposalState = {
        proposals: {},
        addProposal: () => 'id',
        updateProposal: () => {},
        removeProposal: () => {},
        approveProposal: () => {},
        rejectProposal: () => {},
        clearProposals: () => {},
        getProposalsForItem: () => [],
      };

      methodNames.forEach((methodName) => {
        expect(methodName in state).toBe(true);
        expect(typeof (state as any)[methodName]).toBe('function');
      });
    });
  });

  describe('Integration scenarios', () => {
    it('can create multiple proposals for different items', () => {
      const proposals: Record<string, Proposal[]> = {
        item1: [
          {
            id: 'p1',
            type: 'comment',
            lineStart: 1,
            lineEnd: 5,
            content: 'Comment 1',
            author: 'user',
            timestamp: Date.now(),
          },
        ],
        item2: [
          {
            id: 'p2',
            type: 'proposed',
            lineStart: 10,
            lineEnd: 15,
            content: 'Proposed change',
            originalContent: 'Old content',
            author: 'claude',
            timestamp: Date.now(),
          },
        ],
      };

      expect(Object.keys(proposals)).toHaveLength(2);
      expect(proposals.item1).toHaveLength(1);
      expect(proposals.item2).toHaveLength(1);
      expect(proposals.item1[0].type).toBe('comment');
      expect(proposals.item2[0].type).toBe('proposed');
    });

    it('supports proposal state transitions', () => {
      const proposal: Proposal = {
        id: 'p1',
        type: 'proposed',
        lineStart: 1,
        lineEnd: 5,
        content: 'Change',
        author: 'claude',
        timestamp: Date.now(),
      };

      // Transition to approved
      const approved: Proposal = {
        ...proposal,
        type: 'approved',
      };

      expect(approved.type).toBe('approved');
      expect(proposal.type).toBe('proposed'); // Original unchanged
    });
  });
});
