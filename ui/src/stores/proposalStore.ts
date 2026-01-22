/**
 * Proposal Store
 *
 * Zustand store for managing collaborative review proposals and comments.
 * Handles adding, updating, removing, and approving/rejecting proposals per document item.
 */

import { create } from 'zustand';
import type { Proposal, ProposalState } from '@/types/proposal';

/**
 * Generate a unique ID using timestamp and random number
 */
const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${random}`;
};

export const useProposalStore = create<ProposalState>((set, get) => ({
  proposals: {},

  /**
   * Add a new proposal to an item
   * Generates unique ID and timestamp automatically
   */
  addProposal: (itemId: string, proposal: Omit<Proposal, 'id' | 'timestamp'>) => {
    const id = generateId();
    const timestamp = Date.now();
    const newProposal: Proposal = {
      ...proposal,
      id,
      timestamp,
    };

    set((state) => ({
      proposals: {
        ...state.proposals,
        [itemId]: [...(state.proposals[itemId] || []), newProposal],
      },
    }));

    return id;
  },

  /**
   * Update an existing proposal with partial updates
   * Handles proposal not found gracefully (no-op)
   */
  updateProposal: (itemId: string, proposalId: string, updates: Partial<Proposal>) => {
    set((state) => {
      const itemProposals = state.proposals[itemId] || [];
      const proposalExists = itemProposals.some((p) => p.id === proposalId);

      if (!proposalExists) {
        // Silently no-op if proposal not found
        return state;
      }

      return {
        proposals: {
          ...state.proposals,
          [itemId]: itemProposals.map((p) =>
            p.id === proposalId ? { ...p, ...updates } : p
          ),
        },
      };
    });
  },

  /**
   * Remove a proposal from an item
   * Handles proposal not found gracefully (no-op)
   */
  removeProposal: (itemId: string, proposalId: string) => {
    set((state) => {
      const itemProposals = state.proposals[itemId] || [];

      return {
        proposals: {
          ...state.proposals,
          [itemId]: itemProposals.filter((p) => p.id !== proposalId),
        },
      };
    });
  },

  /**
   * Approve a proposal by changing its type to 'approved'
   * Internally calls updateProposal
   */
  approveProposal: (itemId: string, proposalId: string) => {
    get().updateProposal(itemId, proposalId, { type: 'approved' });
  },

  /**
   * Reject a proposal by changing its type to 'rejected'
   * Internally calls updateProposal
   */
  rejectProposal: (itemId: string, proposalId: string) => {
    get().updateProposal(itemId, proposalId, { type: 'rejected' });
  },

  /**
   * Clear all proposals for an item
   * Handles item not found gracefully (no-op)
   */
  clearProposals: (itemId: string) => {
    set((state) => ({
      proposals: {
        ...state.proposals,
        [itemId]: [],
      },
    }));
  },

  /**
   * Get all proposals for an item
   * Returns empty array if item has no proposals
   * Read-only operation (no state mutation)
   */
  getProposalsForItem: (itemId: string) => {
    return get().proposals[itemId] || [];
  },
}));

export default useProposalStore;
